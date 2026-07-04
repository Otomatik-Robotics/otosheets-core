import { and, eq, ne, desc, inArray, lt, or, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { statements } from '../pg/schema/statements';
import { toRow, fromRow } from '../pg/rows';
import { encodeKeysetToken, toKeyset } from '../pg/cursor';
import type { StatementRecord, StatementStatus, StatementVerification, StatementCreate } from './schema';

export interface StatementPage {
    items: StatementRecord[];
    nextToken: string | null;
}

export interface StatementListOptions {
    fy?: string;
    limit?: number;
    nextToken?: string | null;
}

/**
 * Postgres-only statement repo — this domain is born in Postgres, so there is
 * no Dynamo counterpart and no data-backend routing wrapper.
 *
 * Status flips are conditional single UPDATEs (`WHERE status IN (…)`) so that
 * at-least-once triggers (duplicate S3 events, Lambda retries) lose the race
 * cleanly instead of double-processing.
 */
export class StatementPgRepo {
    constructor(private injected?: PgDb) {}

    private get db(): PgDb {
        return this.injected ?? getPg();
    }

    async createStatement(input: StatementCreate): Promise<void> {
        // Idempotent create — retried presign calls with the same ULID are no-ops.
        await this.db.insert(statements)
            .values(toRow(statements, { ...input, status: 'UPLOADED' }, 'statement') as any)
            .onConflictDoNothing({ target: statements.statementId });
    }

    async getStatement(userId: string, statementId: string): Promise<StatementRecord | null> {
        const rows = await this.db.select().from(statements)
            .where(and(eq(statements.statementId, statementId), eq(statements.userId, userId)))
            .limit(1);
        return rows[0] ? fromRow<StatementRecord>(rows[0], ['categoryConfidence']) : null;
    }

    /** Advisor path — resolves a statement inside a client org regardless of owner. */
    async findStatementByIdInOrg(orgId: string, statementId: string): Promise<StatementRecord | null> {
        const rows = await this.db.select().from(statements)
            .where(and(eq(statements.statementId, statementId), eq(statements.organizationId, orgId)))
            .limit(1);
        return rows[0] ? fromRow<StatementRecord>(rows[0]) : null;
    }

    async listStatements(userId: string, opts: StatementListOptions = {}): Promise<StatementPage> {
        return this.list(eq(statements.userId, userId), opts);
    }

    async listStatementsByOrg(orgId: string, opts: StatementListOptions = {}): Promise<StatementPage> {
        return this.list(eq(statements.organizationId, orgId), opts);
    }

    private async list(scope: any, opts: StatementListOptions): Promise<StatementPage> {
        const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
        const conditions: any[] = [scope];
        if (opts.fy) conditions.push(eq(statements.fy, opts.fy));
        if (opts.nextToken) {
            const cursor = toKeyset(opts.nextToken, 'statementId');
            if (cursor) {
                const at = new Date(cursor.createdAt);
                conditions.push(or(
                    lt(statements.createdAt, at),
                    and(eq(statements.createdAt, at), lt(statements.statementId, cursor.id)),
                ));
            }
        }
        const rows = await this.db.select().from(statements)
            .where(and(...conditions))
            .orderBy(desc(statements.createdAt), desc(statements.statementId))
            .limit(limit + 1);
        const page = rows.slice(0, limit);
        const nextToken = rows.length > limit && page.length > 0
            ? encodeKeysetToken({
                createdAt: (page[page.length - 1].createdAt as Date).toISOString(),
                id: page[page.length - 1].statementId as string,
            })
            : null;
        return { items: page.map((r) => fromRow<StatementRecord>(r)), nextToken };
    }

    async findStatementByContentHash(
        userId: string, contentHash: string, excludeStatementId?: string,
    ): Promise<StatementRecord | null> {
        const conditions = [eq(statements.userId, userId), eq(statements.contentHash, contentHash)];
        if (excludeStatementId) conditions.push(ne(statements.statementId, excludeStatementId));
        const rows = await this.db.select().from(statements).where(and(...conditions)).limit(1);
        return rows[0] ? fromRow<StatementRecord>(rows[0]) : null;
    }

    /**
     * Conditional status flip — returns false when the row was not in one of
     * `expectedStatuses` (someone else already owns this transition).
     */
    async updateStatementStatusConditional(
        statementId: string,
        expectedStatuses: StatementStatus[],
        patch: { status: StatementStatus } & Record<string, any>,
    ): Promise<boolean> {
        const updated = await this.db.update(statements)
            .set({ ...toRow(statements, patch, 'statement'), updatedAt: new Date() } as any)
            .where(and(eq(statements.statementId, statementId), inArray(statements.status, expectedStatuses)))
            .returning({ statementId: statements.statementId });
        return updated.length > 0;
    }

    async updateStatement(statementId: string, patch: Record<string, any>): Promise<void> {
        await this.db.update(statements)
            .set({ ...toRow(statements, patch, 'statement'), updatedAt: new Date() } as any)
            .where(eq(statements.statementId, statementId));
    }

    async setProcessingResult(statementId: string, result: {
        status: StatementStatus;
        verification?: StatementVerification | null;
        txnCount?: number;
        needsReviewCount?: number;
        confirmedCount?: number;
        periodStart?: string | null;
        periodEnd?: string | null;
        bankName?: string | null;
        accountLast4?: string | null;
    }): Promise<void> {
        await this.db.update(statements)
            .set({
                ...toRow(statements, result, 'statement'),
                processedAt: new Date(),
                updatedAt: new Date(),
            } as any)
            .where(eq(statements.statementId, statementId));
    }

    /**
     * Atomic counter — never read-modify-write. Returns the new count, or
     * null when the statement doesn't exist.
     */
    async adjustNeedsReviewCount(statementId: string, delta: number): Promise<number | null> {
        const updated = await this.db.update(statements)
            .set({
                needsReviewCount: sql`GREATEST(COALESCE(${statements.needsReviewCount}, 0) + ${delta}, 0)`,
                confirmedCount: delta < 0
                    ? sql`COALESCE(${statements.confirmedCount}, 0) + ${-delta}`
                    : statements.confirmedCount,
                updatedAt: new Date(),
            } as any)
            .where(eq(statements.statementId, statementId))
            .returning({ needsReviewCount: statements.needsReviewCount });
        return updated.length > 0 ? (updated[0].needsReviewCount as number) : null;
    }

    /** Delete — transactions cascade via FK. Scoped to the owner for tenancy. */
    async deleteStatement(userId: string, statementId: string): Promise<boolean> {
        const deleted = await this.db.delete(statements)
            .where(and(eq(statements.statementId, statementId), eq(statements.userId, userId)))
            .returning({ statementId: statements.statementId });
        return deleted.length > 0;
    }

    /** Guest-upload claim: re-point all prospect-owned statements in one UPDATE (idempotent). */
    async claimProspectStatements(
        prospectUserId: string, newUserId: string, organizationId?: string | null,
    ): Promise<number> {
        const updated = await this.db.update(statements)
            .set({ userId: newUserId, organizationId: organizationId ?? null, updatedAt: new Date() } as any)
            .where(eq(statements.userId, prospectUserId))
            .returning({ statementId: statements.statementId });
        return updated.length;
    }
}
