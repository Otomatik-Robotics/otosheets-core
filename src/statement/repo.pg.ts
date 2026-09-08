import { and, eq, ne, desc, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { statements } from '../pg/schema/statements';
import { bankAccounts } from '../pg/schema/bankFeeds';
import { toRow, fromRow } from '../pg/rows';
import { encodeKeysetToken, toKeyset } from '../pg/cursor';
import type {
    StatementRecord, StatementStatus, StatementVerification, StatementCreate,
    StatementPeriodSource, StatementPeriodConflict,
} from './schema';

export interface StatementPage {
    items: StatementRecord[];
    nextToken: string | null;
}

export interface StatementListOptions {
    businessProfileId?: string;
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
    constructor(private injected?: PgDb, private readonly scope?: Readonly<{ orgId: string; businessProfileId: string }>) {}

    withScope(orgId: string, businessProfileId: string): StatementPgRepo {
        if (!orgId.trim() || !businessProfileId.trim()) throw new Error('Statement scope is required');
        if (this.scope && (orgId !== this.scope.orgId || businessProfileId !== this.scope.businessProfileId)) throw new Error('Statement scope mismatch');
        return new StatementPgRepo(this.injected, Object.freeze({ orgId, businessProfileId }));
    }

    private within(...conditions: (SQL | undefined)[]) {
        return and(...conditions, ...(this.scope ? [eq(statements.organizationId, this.scope.orgId), eq(statements.businessProfileId, this.scope.businessProfileId)] : []));
    }

    private patch(input: Record<string, any>) {
        const patch = { ...input };
        if (this.scope) {
            if (patch.organizationId !== undefined && patch.organizationId !== this.scope.orgId) throw new Error('Statement scope mismatch');
            if (patch.businessProfileId !== undefined && patch.businessProfileId !== this.scope.businessProfileId) throw new Error('Statement scope mismatch');
            for (const key of ['organizationId', 'businessProfileId', 'statementId', 'userId', 'createdAt', 's3Key']) delete patch[key];
        }
        return patch;
    }

    private async validateReferences(input: Record<string, any>, userId: string) {
        if (!this.scope) return;
        if (input.accountId != null) {
            const [account] = await this.db.select({ id: bankAccounts.accountId }).from(bankAccounts)
                .where(and(eq(bankAccounts.accountId, input.accountId), eq(bankAccounts.userId, userId),
                    eq(bankAccounts.organizationId, this.scope.orgId), eq(bankAccounts.businessProfileId, this.scope.businessProfileId))).limit(1);
            if (!account) throw new Error('Statement account reference ownership mismatch');
        }
        if (input.duplicateOfStatementId != null) {
            if (!await this.getStatement(userId, input.duplicateOfStatementId)) throw new Error('Statement duplicate reference ownership mismatch');
        }
    }

    private async checkedPatch(statementId: string, input: Record<string, any>) {
        const patch = this.patch(input);
        if (this.scope && (patch.accountId != null || patch.duplicateOfStatementId != null)) {
            const [source] = await this.db.select({ userId: statements.userId }).from(statements)
                .where(this.within(eq(statements.statementId, statementId))).limit(1);
            // A foreign source remains a no-op, without inspecting its references.
            if (source) await this.validateReferences(patch, source.userId);
        }
        return patch;
    }

    private get db(): PgDb {
        return this.injected ?? getPg();
    }

    async createStatement(input: StatementCreate): Promise<void> {
        if (this.scope) { this.patch(input); await this.validateReferences(input, input.userId); }
        // Idempotent create — retried presign calls with the same ULID are no-ops.
        await this.db.insert(statements)
            .values(toRow(statements, { ...input, ...(this.scope ? { organizationId: this.scope.orgId, businessProfileId: this.scope.businessProfileId } : {}), status: 'UPLOADED' }, 'statement') as any)
            .onConflictDoNothing({ target: statements.statementId });
    }

    async getStatement(userId: string, statementId: string): Promise<StatementRecord | null> {
        const rows = await this.db.select().from(statements)
            .where(this.within(eq(statements.statementId, statementId), eq(statements.userId, userId)))
            .limit(1);
        return rows[0] ? fromRow<StatementRecord>(rows[0], ['categoryConfidence']) : null;
    }

    /** Advisor path — resolves a statement inside a client org regardless of owner. */
    async findStatementByIdInOrg(orgId: string, statementId: string): Promise<StatementRecord | null> {
        const rows = await this.db.select().from(statements)
            .where(this.within(eq(statements.statementId, statementId), eq(statements.organizationId, orgId)))
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
        if (opts.businessProfileId) conditions.push(eq(statements.businessProfileId, opts.businessProfileId));
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
            .where(this.within(...conditions))
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

    /**
     * All statements sharing one account identity — the continuity check's
     * input (opening↔closing stitching, period-overlap detection). Ordered by
     * periodStart (unresolved periods last). Bounded set per account; capped.
     */
    async listStatementsByAccount(
        userId: string, accountId: string, opts: { excludeStatementId?: string; cap?: number } = {},
    ): Promise<StatementRecord[]> {
        const conditions = [eq(statements.userId, userId), eq(statements.accountId, accountId)];
        if (opts.excludeStatementId) conditions.push(ne(statements.statementId, opts.excludeStatementId));
        const rows = await this.db.select().from(statements)
            .where(this.within(...conditions))
            .orderBy(sql`${statements.periodStart} ASC NULLS LAST`, desc(statements.createdAt))
            .limit(Math.min(opts.cap ?? 100, 200));
        return rows.map((r) => fromRow<StatementRecord>(r));
    }

    async findStatementByContentHash(
        userId: string, contentHash: string, excludeStatementId?: string,
    ): Promise<StatementRecord | null> {
        const conditions = [eq(statements.userId, userId), eq(statements.contentHash, contentHash)];
        if (excludeStatementId) conditions.push(ne(statements.statementId, excludeStatementId));
        const rows = await this.db.select().from(statements).where(this.within(...conditions)).limit(1);
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
            .set({ ...toRow(statements, await this.checkedPatch(statementId, patch), 'statement'), updatedAt: new Date() } as any)
            .where(this.within(eq(statements.statementId, statementId), inArray(statements.status, expectedStatuses)))
            .returning({ statementId: statements.statementId });
        return updated.length > 0;
    }

    async updateStatement(statementId: string, patch: Record<string, any>): Promise<void> {
        await this.db.update(statements)
            .set({ ...toRow(statements, await this.checkedPatch(statementId, patch), 'statement'), updatedAt: new Date() } as any)
            .where(this.within(eq(statements.statementId, statementId)));
    }

    async setProcessingResult(statementId: string, result: {
        status: StatementStatus;
        verification?: StatementVerification | null;
        txnCount?: number;
        needsReviewCount?: number;
        confirmedCount?: number;
        periodStart?: string | null;
        periodEnd?: string | null;
        periodSource?: StatementPeriodSource | null;
        periodConflict?: StatementPeriodConflict | null;
        bankName?: string | null;
        accountLast4?: string | null;
    }): Promise<void> {
        await this.db.update(statements)
            .set({
                ...toRow(statements, await this.checkedPatch(statementId, result), 'statement'),
                processedAt: new Date(),
                updatedAt: new Date(),
            } as any)
            .where(this.within(eq(statements.statementId, statementId)));
    }

    /**
     * Apply a user's manual period choice (disambiguation modal): set the period,
     * mark its source 'user', clear the stored conflict, and — when supplied —
     * flip the status (typically NEEDS_REVIEW → VERIFIED once the conflict is the
     * last thing holding review open). Scoped to the owner for tenancy; returns
     * false when no row matched.
     */
    async resolvePeriod(userId: string, statementId: string, input: {
        periodStart: string;
        periodEnd: string;
        status?: StatementStatus;
    }): Promise<boolean> {
        const updated = await this.db.update(statements)
            .set({
                ...toRow(statements, {
                    periodStart: input.periodStart,
                    periodEnd: input.periodEnd,
                    periodSource: 'user' as StatementPeriodSource,
                    periodConflict: null,
                    ...(input.status ? { status: input.status } : {}),
                }, 'statement'),
                updatedAt: new Date(),
            } as any)
            .where(this.within(eq(statements.statementId, statementId), eq(statements.userId, userId)))
            .returning({ statementId: statements.statementId });
        return updated.length > 0;
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
            .where(this.within(eq(statements.statementId, statementId)))
            .returning({ needsReviewCount: statements.needsReviewCount });
        return updated.length > 0 ? (updated[0].needsReviewCount as number) : null;
    }

    /** Delete — transactions cascade via FK. Scoped to the owner for tenancy. */
    async deleteStatement(userId: string, statementId: string): Promise<boolean> {
        const deleted = await this.db.delete(statements)
            .where(this.within(eq(statements.statementId, statementId), eq(statements.userId, userId)))
            .returning({ statementId: statements.statementId });
        return deleted.length > 0;
    }

    /** Guest-upload claim: re-point all prospect-owned statements in one UPDATE (idempotent). */
    async claimProspectStatements(
        prospectUserId: string, newUserId: string, organizationId?: string | null,
    ): Promise<number> {
        if (this.scope) throw new Error('Guest ownership claims require explicit reviewed assignment');
        const updated = await this.db.update(statements)
            .set({ userId: newUserId, organizationId: organizationId ?? null, updatedAt: new Date() } as any)
            .where(eq(statements.userId, prospectUserId))
            .returning({ statementId: statements.statementId });
        return updated.length;
    }
}
