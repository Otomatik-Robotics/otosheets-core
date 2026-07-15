import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { bankTransactions } from '../pg/schema/bankFeeds';
import { toRow, fromRow } from '../pg/rows';
import type { BankTransaction, BankTransactionCategoryPatch } from './schema';

const NUMERIC_KEYS = ['categoryConfidence'];

/** Extraction-layer columns a re-sync is allowed to overwrite. The annotation
 *  layer (category/GST/review) is deliberately excluded so a repeat sync of the
 *  same transaction never clobbers a user's categorisation or review decision. */
const SYNC_COLUMNS = [
    'accountId', 'userId', 'organizationId', 'fy', 'txnDate', 'description',
    'amountCents', 'direction', 'status', 'merchantName', 'providerCategory', 'raw',
];

export interface BankTxnPage {
    items: BankTransaction[];
    nextToken: string | null;
}

export interface BankCategorySummaryRow {
    category: string;
    inCents: number;   // credits (money in)
    outCents: number;  // debits (money out, positive number)
    gstCents: number;
    txnCount: number;
    confirmedCount: number;
}

export interface BankTxnListOptions {
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

const EPOCH_DATE = '0001-01-01'; // sort-key stand-in for rows with no parseable date

/** Slim feed row — the statement pipeline's dedupe comparison set. */
export interface BankTxnDedupeRow {
    txnId: string;
    txnDate: string | null;
    amountCents: number;
    description: string | null;
}

/**
 * Postgres-only repo for open-banking feed transactions (born in Postgres).
 * Sibling of StatementTransactionPgRepo — same keyset pagination and per-category
 * reporting, but `upsertTransactions` protects the annotation layer on re-sync.
 */
export class BankTransactionPgRepo {
    constructor(private injected?: PgDb) {}

    private get db(): PgDb {
        return this.injected ?? getPg();
    }

    /**
     * Insert or refresh feed transactions (provider txn id is the PK). On
     * conflict only the extraction columns are overwritten — the categorisation
     * and review columns are left intact so a re-sync is idempotent AND
     * non-destructive to user annotations (idempotency §5.3).
     */
    async upsertTransactions(items: Array<Record<string, any>>): Promise<void> {
        if (items.length === 0) return;
        const CHUNK = 200;
        for (let i = 0; i < items.length; i += CHUNK) {
            const rows = items.slice(i, i + CHUNK).map((item) => toRow(bankTransactions, item, 'bankTransaction'));
            const setClause: Record<string, any> = {};
            for (const key of SYNC_COLUMNS) {
                const col = (bankTransactions as any)[key];
                if (col) setClause[key] = sql.raw(`excluded.${col.name}`);
            }
            await this.db.insert(bankTransactions)
                .values(rows as any)
                .onConflictDoUpdate({
                    target: bankTransactions.txnId,
                    set: { ...setClause, updatedAt: new Date() } as any,
                });
        }
    }

    /**
     * Slim rows of one feed account in a date window — the statement pipeline
     * dedupes a fresh upload against these when the statement resolved to the
     * same (unified) account, so feed + statement never double-count.
     */
    async listRowsForDedupe(userId: string, accountId: string, opts: {
        dateFrom: string; dateTo: string; cap?: number;
    }): Promise<BankTxnDedupeRow[]> {
        const rows = await this.db.select({
            txnId: bankTransactions.txnId,
            txnDate: bankTransactions.txnDate,
            amountCents: bankTransactions.amountCents,
            description: bankTransactions.description,
        })
            .from(bankTransactions)
            .where(and(
                eq(bankTransactions.userId, userId),
                eq(bankTransactions.accountId, accountId),
                isNull(bankTransactions.duplicateOfTxnId),
                sql`${bankTransactions.txnDate} >= ${opts.dateFrom}::date`,
                sql`${bankTransactions.txnDate} <= ${opts.dateTo}::date`,
            ))
            .orderBy(sql`${bankTransactions.txnDate} ASC`, sql`${bankTransactions.txnId} ASC`)
            .limit(opts.cap ?? 5000);
        return rows.map((r) => ({
            txnId: r.txnId,
            txnDate: (r.txnDate as string | null) ?? null,
            amountCents: Number(r.amountCents),
            description: (r.description as string | null) ?? null,
        }));
    }

    async getTransaction(userId: string, txnId: string): Promise<BankTransaction | null> {
        const rows = await this.db.select().from(bankTransactions)
            .where(and(eq(bankTransactions.txnId, txnId), eq(bankTransactions.userId, userId)))
            .limit(1);
        return rows[0] ? fromRow<BankTransaction>(rows[0], NUMERIC_KEYS) : null;
    }

    /**
     * Mark feed rows as duplicates of statement rows (reverse-direction
     * dedupe, run after each sync). Idempotent; sync upserts never clear the
     * marker because duplicate_of_txn_id is not a SYNC_COLUMN.
     */
    async markDuplicates(updates: Array<{ txnId: string; duplicateOfTxnId: string }>): Promise<void> {
        const CHUNK = 200;
        for (let i = 0; i < updates.length; i += CHUNK) {
            const chunk = updates.slice(i, i + CHUNK);
            const values = sql.join(
                chunk.map((u) => sql`(${u.txnId}, ${u.duplicateOfTxnId})`),
                sql`, `,
            );
            await this.db.execute(sql`
                UPDATE bank_transactions AS t
                SET duplicate_of_txn_id = v.dup_id, updated_at = now()
                FROM (VALUES ${values}) AS v(txn_id, dup_id)
                WHERE t.txn_id = v.txn_id
            `);
        }
    }

    /** Transactions of one account, newest date first — keyset on (date, txnId). */
    async listByAccount(userId: string, accountId: string, opts: BankTxnListOptions = {}): Promise<BankTxnPage> {
        const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
        const sortDate = sql`COALESCE(${bankTransactions.txnDate}, ${EPOCH_DATE}::date)`;
        const conditions: any[] = [
            eq(bankTransactions.userId, userId),
            eq(bankTransactions.accountId, accountId),
        ];
        if (opts.reviewOnly) conditions.push(isNotNull(bankTransactions.reviewReason));
        if (opts.nextToken) {
            const cursor = decodeToken(opts.nextToken);
            if (cursor && typeof cursor.d === 'string' && typeof cursor.id === 'string') {
                conditions.push(sql`(${sortDate}, ${bankTransactions.txnId}) < (${cursor.d}::date, ${cursor.id})`);
            }
        }
        const rows = await this.db.select().from(bankTransactions)
            .where(and(...conditions))
            .orderBy(sql`${sortDate} DESC`, sql`${bankTransactions.txnId} DESC`)
            .limit(limit + 1);
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        const nextToken = rows.length > limit && last
            ? encodeToken({ v: 2, d: (last.txnDate as string | null) ?? EPOCH_DATE, id: last.txnId })
            : null;
        return { items: page.map((r) => fromRow<BankTransaction>(r, NUMERIC_KEYS)), nextToken };
    }

    /** FY-wide listing across every account, newest date first — keyset on (date, txnId). */
    async listByFy(userId: string, fy: string, opts: BankTxnListOptions = {}): Promise<BankTxnPage> {
        const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
        const sortDate = sql`COALESCE(${bankTransactions.txnDate}, ${EPOCH_DATE}::date)`;
        const conditions: any[] = [
            eq(bankTransactions.userId, userId),
            eq(bankTransactions.fy, fy),
        ];
        if (opts.reviewOnly) conditions.push(isNotNull(bankTransactions.reviewReason));
        if (opts.nextToken) {
            const cursor = decodeToken(opts.nextToken);
            if (cursor && typeof cursor.d === 'string' && typeof cursor.id === 'string') {
                conditions.push(sql`(${sortDate}, ${bankTransactions.txnId}) < (${cursor.d}::date, ${cursor.id})`);
            }
        }
        const rows = await this.db.select().from(bankTransactions)
            .where(and(...conditions))
            .orderBy(sql`${sortDate} DESC`, sql`${bankTransactions.txnId} DESC`)
            .limit(limit + 1);
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        const nextToken = rows.length > limit && last
            ? encodeToken({ v: 2, d: (last.txnDate as string | null) ?? EPOCH_DATE, id: last.txnId })
            : null;
        return { items: page.map((r) => fromRow<BankTransaction>(r, NUMERIC_KEYS)), nextToken };
    }

    /**
     * Update the annotation layer on one transaction and (optionally) clear its
     * review flag in a single statement — returns whether a `review_reason` was
     * previously set so the caller can adjust any review counter exactly once
     * under retries (Neon HTTP has no interactive transactions).
     */
    async updateCategory(
        userId: string,
        txnId: string,
        patch: BankTransactionCategoryPatch,
        opts: { confirm?: boolean } = {},
    ): Promise<{ found: boolean; hadReviewReason: boolean }> {
        const confirm = opts.confirm !== false;
        const result: any = await this.db.execute(sql`
            WITH before AS (
                SELECT txn_id, review_reason FROM bank_transactions
                WHERE txn_id = ${txnId} AND user_id = ${userId}
            )
            UPDATE bank_transactions t SET
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

    /**
     * Per-category tallies — the reporting payoff of the born-in-Postgres
     * decision. Signed cents split into money-in/money-out; scoped by user (or
     * org for advisors), with optional FY / date-range / account filters.
     */
    async summariseByCategory(scope: {
        userId?: string;
        organizationId?: string;
        accountId?: string;
        fy?: string;
        dateFrom?: string;
        dateTo?: string;
    }): Promise<BankCategorySummaryRow[]> {
        if (!scope.userId && !scope.organizationId) {
            throw new Error('summariseByCategory requires a userId or organizationId scope');
        }
        // Rows a statement already ingested never count toward any summary.
        const conditions: any[] = [isNull(bankTransactions.duplicateOfTxnId)];
        if (scope.userId) conditions.push(eq(bankTransactions.userId, scope.userId));
        if (scope.organizationId) conditions.push(eq(bankTransactions.organizationId, scope.organizationId));
        if (scope.accountId) conditions.push(eq(bankTransactions.accountId, scope.accountId));
        if (scope.fy) conditions.push(eq(bankTransactions.fy, scope.fy));
        if (scope.dateFrom) conditions.push(sql`${bankTransactions.txnDate} >= ${scope.dateFrom}::date`);
        if (scope.dateTo) conditions.push(sql`${bankTransactions.txnDate} <= ${scope.dateTo}::date`);
        const rows = await this.db.select({
            category: sql<string>`COALESCE(${bankTransactions.category}, 'UNCATEGORIZED')`,
            inCents: sql<number>`COALESCE(SUM(CASE WHEN ${bankTransactions.amountCents} > 0 THEN ${bankTransactions.amountCents} ELSE 0 END), 0)::bigint`,
            outCents: sql<number>`COALESCE(SUM(CASE WHEN ${bankTransactions.amountCents} < 0 THEN -${bankTransactions.amountCents} ELSE 0 END), 0)::bigint`,
            gstCents: sql<number>`COALESCE(SUM(COALESCE(${bankTransactions.gstAmountCents}, 0)), 0)::bigint`,
            txnCount: sql<number>`COUNT(*)::int`,
            confirmedCount: sql<number>`SUM(CASE WHEN ${bankTransactions.reviewStatus} = 'CONFIRMED' THEN 1 ELSE 0 END)::int`,
        })
            .from(bankTransactions)
            .where(and(...conditions))
            .groupBy(sql`COALESCE(${bankTransactions.category}, 'UNCATEGORIZED')`)
            .orderBy(sql`GREATEST(
                COALESCE(SUM(CASE WHEN ${bankTransactions.amountCents} > 0 THEN ${bankTransactions.amountCents} ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN ${bankTransactions.amountCents} < 0 THEN -${bankTransactions.amountCents} ELSE 0 END), 0)
            ) DESC`);
        return rows.map((r) => ({
            category: r.category,
            inCents: Number(r.inCents),
            outCents: Number(r.outCents),
            gstCents: Number(r.gstCents),
            txnCount: Number(r.txnCount),
            confirmedCount: Number(r.confirmedCount),
        }));
    }

    /** Wipe an account's transactions (FK cascade also covers account deletes). */
    async deleteByAccount(accountId: string): Promise<number> {
        const deleted = await this.db.delete(bankTransactions)
            .where(eq(bankTransactions.accountId, accountId))
            .returning({ txnId: bankTransactions.txnId });
        return deleted.length;
    }
}
