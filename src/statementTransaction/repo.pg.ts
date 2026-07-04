import { and, asc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { statementTransactions } from '../pg/schema/statements';
import { toRow, fromRow } from '../pg/rows';
import type { StatementTransaction, StatementTransactionCategoryPatch } from './schema';

const NUMERIC_KEYS = ['categoryConfidence'];

export interface TxnPage {
    items: StatementTransaction[];
    nextToken: string | null;
}

export interface TxnListOptions {
    limit?: number;
    nextToken?: string | null;
    reviewOnly?: boolean;
}

function encodeToken(obj: unknown): string {
    return Buffer.from(JSON.stringify(obj)).toString('base64');
}

function decodeToken(token: string): any {
    try {
        return JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
    } catch {
        return null;
    }
}

/** Deterministic transaction id — '{statementId}#{seq5}' (idempotency §5.3). */
export function statementTxnId(statementId: string, seq: number): string {
    return `${statementId}#${String(seq).padStart(5, '0')}`;
}

const EPOCH_DATE = '0001-01-01'; // sort key stand-in for rows with no parseable date

/**
 * Postgres-only repo for extracted statement transactions (born in Postgres).
 *
 * The extraction layer is written by `upsertTransactions` with deterministic
 * PKs, so pipeline re-runs are idempotent. The annotation layer (category /
 * GST / review) is only touched via `updateCategory`, which reports whether
 * the row previously carried a `review_reason` so callers can adjust the
 * statement counter exactly once (Neon HTTP has no interactive transactions —
 * the read-and-clear happens in a single CTE statement).
 */
export class StatementTransactionPgRepo {
    constructor(private injected?: PgDb) {}

    private get db(): PgDb {
        return this.injected ?? getPg();
    }

    async upsertTransactions(items: Array<Record<string, any>>): Promise<void> {
        const CHUNK = 200;
        for (let i = 0; i < items.length; i += CHUNK) {
            const rows = items.slice(i, i + CHUNK).map((item) => {
                const row = toRow(statementTransactions, item, 'statementTransaction') as any;
                row.txnId = row.txnId ?? statementTxnId(item.statementId, item.seq);
                return row;
            });
            const { txnId, createdAt, ...rest } = rows[0];
            const setClause: Record<string, any> = {};
            for (const key of Object.keys(rest)) {
                setClause[key] = sql.raw(`excluded.${(statementTransactions as any)[key].name}`);
            }
            await this.db.insert(statementTransactions)
                .values(rows)
                .onConflictDoUpdate({
                    target: statementTransactions.txnId,
                    set: { ...setClause, updatedAt: new Date() } as any,
                });
        }
    }

    async getTransaction(userId: string, statementId: string, seq: number): Promise<StatementTransaction | null> {
        const rows = await this.db.select().from(statementTransactions)
            .where(and(
                eq(statementTransactions.txnId, statementTxnId(statementId, seq)),
                eq(statementTransactions.userId, userId),
            ))
            .limit(1);
        return rows[0] ? fromRow<StatementTransaction>(rows[0], NUMERIC_KEYS) : null;
    }

    /** Transactions of one statement in row order — keyset on `seq`. */
    async listByStatement(userId: string, statementId: string, opts: TxnListOptions = {}): Promise<TxnPage> {
        const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
        const conditions: any[] = [
            eq(statementTransactions.statementId, statementId),
            eq(statementTransactions.userId, userId),
        ];
        if (opts.reviewOnly) conditions.push(isNotNull(statementTransactions.reviewReason));
        if (opts.nextToken) {
            const cursor = decodeToken(opts.nextToken);
            if (cursor && typeof cursor.seq === 'number') {
                conditions.push(gt(statementTransactions.seq, cursor.seq));
            }
        }
        const rows = await this.db.select().from(statementTransactions)
            .where(and(...conditions))
            .orderBy(asc(statementTransactions.seq))
            .limit(limit + 1);
        const page = rows.slice(0, limit);
        const nextToken = rows.length > limit && page.length > 0
            ? encodeToken({ v: 2, seq: page[page.length - 1].seq })
            : null;
        return { items: page.map((r) => fromRow<StatementTransaction>(r, NUMERIC_KEYS)), nextToken };
    }

    /** FY-wide listing, newest transaction date first — keyset on (date, txnId). */
    async listByFy(userId: string, fy: string, opts: TxnListOptions = {}): Promise<TxnPage> {
        const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
        const sortDate = sql`COALESCE(${statementTransactions.txnDate}, ${EPOCH_DATE}::date)`;
        const conditions: any[] = [
            eq(statementTransactions.userId, userId),
            eq(statementTransactions.fy, fy),
        ];
        if (opts.reviewOnly) conditions.push(isNotNull(statementTransactions.reviewReason));
        if (opts.nextToken) {
            const cursor = decodeToken(opts.nextToken);
            if (cursor && typeof cursor.d === 'string' && typeof cursor.id === 'string') {
                conditions.push(sql`(${sortDate}, ${statementTransactions.txnId}) < (${cursor.d}::date, ${cursor.id})`);
            }
        }
        const rows = await this.db.select().from(statementTransactions)
            .where(and(...conditions))
            .orderBy(sql`${sortDate} DESC`, sql`${statementTransactions.txnId} DESC`)
            .limit(limit + 1);
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        const nextToken = rows.length > limit && last
            ? encodeToken({ v: 2, d: (last.txnDate as string | null) ?? EPOCH_DATE, id: last.txnId })
            : null;
        return { items: page.map((r) => fromRow<StatementTransaction>(r, NUMERIC_KEYS)), nextToken };
    }

    /** Cross-statement review queue for a user — keyset on txnId. */
    async listReview(userId: string, opts: TxnListOptions = {}): Promise<TxnPage> {
        const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
        const conditions: any[] = [
            eq(statementTransactions.userId, userId),
            isNotNull(statementTransactions.reviewReason),
        ];
        if (opts.nextToken) {
            const cursor = decodeToken(opts.nextToken);
            if (cursor && typeof cursor.id === 'string') {
                conditions.push(gt(statementTransactions.txnId, cursor.id));
            }
        }
        const rows = await this.db.select().from(statementTransactions)
            .where(and(...conditions))
            .orderBy(asc(statementTransactions.txnId))
            .limit(limit + 1);
        const page = rows.slice(0, limit);
        const nextToken = rows.length > limit && page.length > 0
            ? encodeToken({ v: 2, id: page[page.length - 1].txnId })
            : null;
        return { items: page.map((r) => fromRow<StatementTransaction>(r, NUMERIC_KEYS)), nextToken };
    }

    /**
     * Update the annotation layer on one transaction and (optionally) clear
     * its review flag — a single CTE statement returns whether a
     * `review_reason` was previously set, so the caller decrements the
     * statement's `needs_review_count` exactly once even under retries.
     */
    async updateCategory(
        userId: string,
        statementId: string,
        seq: number,
        patch: StatementTransactionCategoryPatch,
        opts: { confirm?: boolean } = {},
    ): Promise<{ found: boolean; hadReviewReason: boolean }> {
        const txnId = statementTxnId(statementId, seq);
        const confirm = opts.confirm !== false;
        const result: any = await this.db.execute(sql`
            WITH before AS (
                SELECT txn_id, review_reason FROM statement_transactions
                WHERE txn_id = ${txnId} AND user_id = ${userId}
            )
            UPDATE statement_transactions t SET
                category            = ${patch.category ?? null},
                category_source     = ${patch.categorySource},
                category_confidence = ${patch.categoryConfidence ?? null},
                gst_treatment       = ${patch.gstTreatment ?? null},
                gst_amount_cents    = ${patch.gstAmountCents ?? null},
                review_reason       = CASE WHEN ${confirm} THEN NULL ELSE t.review_reason END,
                review_status       = CASE WHEN ${confirm} THEN 'CONFIRMED' ELSE t.review_status END,
                confirmed_by        = CASE WHEN ${confirm} THEN ${patch.confirmedBy ?? null} ELSE t.confirmed_by END,
                confirmed_at        = CASE WHEN ${confirm} THEN now() ELSE t.confirmed_at END,
                updated_at          = now()
            FROM before
            WHERE t.txn_id = before.txn_id
            RETURNING before.review_reason AS prev_review_reason
        `);
        const rows = result.rows ?? result;
        if (!rows || rows.length === 0) return { found: false, hadReviewReason: false };
        return { found: true, hadReviewReason: rows[0].prev_review_reason != null };
    }

    /** Wipe a statement's transactions (reprocess path — FK cascade covers deletes). */
    async deleteByStatement(statementId: string): Promise<number> {
        const deleted = await this.db.delete(statementTransactions)
            .where(eq(statementTransactions.statementId, statementId))
            .returning({ txnId: statementTransactions.txnId });
        return deleted.length;
    }

    /** Guest-upload claim — run BEFORE claimProspectStatements so a crash mid-claim resumes cleanly. */
    async claimProspectTransactions(
        prospectUserId: string, newUserId: string,
    ): Promise<number> {
        const updated = await this.db.update(statementTransactions)
            .set({ userId: newUserId, updatedAt: new Date() } as any)
            .where(eq(statementTransactions.userId, prospectUserId))
            .returning({ txnId: statementTransactions.txnId });
        return updated.length;
    }
}
