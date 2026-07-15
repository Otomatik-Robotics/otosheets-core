import { and, asc, eq, gt, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { statementTransactions, statements } from '../pg/schema/statements';
import { toRow, fromRow } from '../pg/rows';
import type { StatementTransaction, StatementTransactionCategoryPatch } from './schema';

const NUMERIC_KEYS = ['categoryConfidence'];

export interface TxnPage {
    items: StatementTransaction[];
    nextToken: string | null;
}

/** One row of the per-category tally. All money is integer cents. */
export interface CategorySummaryRow {
    category: string;
    inCents: number;   // credits (money in)
    outCents: number;  // debits (money out, positive number)
    gstCents: number;
    txnCount: number;
    confirmedCount: number;
}

/** Scope shared by the summary queries — user OR org, optionally narrowed. */
export interface TxnSummaryScope {
    userId?: string;
    organizationId?: string;
    fy?: string;
    statementId?: string;
    /** Inclusive YYYY-MM-DD bounds on txn_date — BAS month/quarter/year views. */
    dateFrom?: string;
    dateTo?: string;
}

/**
 * One bank account's rollup — transactions grouped by the parent statement's
 * detected bank + account. `netCents` is the true movement (Σ of every amount,
 * incl. transfers) = closing − opening across the account's statements. Rows
 * with an undetected account (both fields null) collapse into one group.
 */
export interface AccountSummaryRow {
    /** Stable account identity (bank_accounts.accountId); null for legacy statements not yet reprocessed. */
    accountId: string | null;
    bankName: string | null;
    accountLast4: string | null;
    inCents: number;   // credits (money in)
    outCents: number;  // debits (money out, positive number)
    /**
     * Bank movement. Anchored to the statement balances — the latest closing
     * minus the earliest opening — when both are available (authoritative, and
     * robust to any unparsed rows); falls back to the signed Σ of amounts only
     * when a statement carries no verified balances.
     */
    netCents: number;
    /** Earliest statement's opening balance; null if no statement carried one. */
    openingBalanceCents: number | null;
    /** Latest statement's closing balance; null if no statement carried one. */
    closingBalanceCents: number | null;
    txnCount: number;
    statementCount: number;
}

/** One row of the deterministic money-flow tally. All money is integer cents. */
export interface FlowSummaryRow {
    /** INCOME | EXPENSE | TRANSFER | REFUND, or 'UNCLASSIFIED' for pre-column rows. */
    flowClass: string;
    inCents: number;   // credits (money in)
    outCents: number;  // debits (money out, positive number)
    txnCount: number;
}

/**
 * One row of the categorisation-provenance rollup — quantifies how much of
 * each dollar total is deterministic vs LLM vs unknown.
 */
export interface CoverageSummaryRow {
    /** DETERMINISTIC (rule/user/advisor) | AI | UNCATEGORIZED */
    bucket: string;
    inCents: number;
    outCents: number;
    txnCount: number;
    confirmedCount: number;
}

/** A transfer-class row, slim shape for cross-statement pairing. */
export interface TransferRow {
    txnId: string;
    statementId: string;
    /** The parent statement's stable account identity (null when undetected). */
    accountId: string | null;
    txnDate: string | null;
    amountCents: number;
    description: string | null;
}

/** A slim existing row, the dedupe comparison set for a fresh ingest. */
export interface DedupeCandidateRow {
    txnId: string;
    statementId: string;
    txnDate: string | null;
    amountCents: number;
    description: string | null;
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
                // The matching layer is user-owned: a reprocess upsert of the same
                // deterministic txnId must never clobber an accepted link.
                if (key === 'matchedInvoiceId' || key === 'matchedReceiptId' || key === 'matchSource') continue;
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

    /**
     * Per-category tallies — the reporting payoff of the born-in-Postgres
     * decision. Signed cents split into money-in/money-out so income and
     * expense categories tally correctly; scoped by user OR org (advisor).
     */
    /** Build the shared WHERE conditions for the summary queries. */
    private scopeConditions(scope: TxnSummaryScope, caller: string): any[] {
        if (!scope.userId && !scope.organizationId) {
            throw new Error(`${caller} requires a userId or organizationId scope`);
        }
        // Duplicate rows (re-ingested by an overlapping statement) never count
        // toward any summary — they exist only for provenance/audit.
        const conditions: any[] = [isNull(statementTransactions.duplicateOfTxnId)];
        if (scope.userId) conditions.push(eq(statementTransactions.userId, scope.userId));
        if (scope.statementId) conditions.push(eq(statementTransactions.statementId, scope.statementId));
        if (scope.fy) conditions.push(eq(statementTransactions.fy, scope.fy));
        if (scope.dateFrom) conditions.push(sql`${statementTransactions.txnDate} >= ${scope.dateFrom}::date`);
        if (scope.dateTo) conditions.push(sql`${statementTransactions.txnDate} <= ${scope.dateTo}::date`);
        if (scope.organizationId) {
            conditions.push(sql`${statementTransactions.statementId} IN (
                SELECT statement_id FROM statements WHERE organization_id = ${scope.organizationId}
            )`);
        }
        return conditions;
    }

    async summariseByCategory(scope: TxnSummaryScope): Promise<CategorySummaryRow[]> {
        const conditions = this.scopeConditions(scope, 'summariseByCategory');
        const rows = await this.db.select({
            category: sql<string>`COALESCE(${statementTransactions.category}, 'UNCATEGORIZED')`,
            inCents: sql<number>`COALESCE(SUM(CASE WHEN ${statementTransactions.amountCents} > 0 THEN ${statementTransactions.amountCents} ELSE 0 END), 0)::bigint`,
            outCents: sql<number>`COALESCE(SUM(CASE WHEN ${statementTransactions.amountCents} < 0 THEN -${statementTransactions.amountCents} ELSE 0 END), 0)::bigint`,
            gstCents: sql<number>`COALESCE(SUM(COALESCE(${statementTransactions.gstAmountCents}, 0)), 0)::bigint`,
            txnCount: sql<number>`COUNT(*)::int`,
            confirmedCount: sql<number>`SUM(CASE WHEN ${statementTransactions.reviewStatus} = 'CONFIRMED' THEN 1 ELSE 0 END)::int`,
        })
            .from(statementTransactions)
            .where(and(...conditions))
            .groupBy(sql`COALESCE(${statementTransactions.category}, 'UNCATEGORIZED')`)
            .orderBy(sql`GREATEST(
                COALESCE(SUM(CASE WHEN ${statementTransactions.amountCents} > 0 THEN ${statementTransactions.amountCents} ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN ${statementTransactions.amountCents} < 0 THEN -${statementTransactions.amountCents} ELSE 0 END), 0)
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

    /**
     * Deterministic top-line tallies — GROUP BY flow_class, so the income /
     * expenditure / transfer totals rest on the sign+pattern layer, never the
     * LLM category. Rows extracted before the column existed group under
     * 'UNCLASSIFIED' (a reprocess backfills them).
     */
    async summariseFlows(scope: TxnSummaryScope): Promise<FlowSummaryRow[]> {
        const conditions = this.scopeConditions(scope, 'summariseFlows');
        const flowExpr = sql`COALESCE(${statementTransactions.flowClass}, 'UNCLASSIFIED')`;
        const rows = await this.db.select({
            flowClass: sql<string>`${flowExpr}`,
            inCents: sql<number>`COALESCE(SUM(CASE WHEN ${statementTransactions.amountCents} > 0 THEN ${statementTransactions.amountCents} ELSE 0 END), 0)::bigint`,
            outCents: sql<number>`COALESCE(SUM(CASE WHEN ${statementTransactions.amountCents} < 0 THEN -${statementTransactions.amountCents} ELSE 0 END), 0)::bigint`,
            txnCount: sql<number>`COUNT(*)::int`,
        })
            .from(statementTransactions)
            .where(and(...conditions))
            .groupBy(flowExpr);
        return rows.map((r) => ({
            flowClass: r.flowClass,
            inCents: Number(r.inCents),
            outCents: Number(r.outCents),
            txnCount: Number(r.txnCount),
        }));
    }

    /**
     * Per-account rollup — transactions grouped by the parent statement's
     * detected bank + account (JOIN to statements). `netCents` is the true
     * bank movement (signed Σ of every amount, incl. transfers). Ordered by
     * net descending; an undetected account (both null) is one group.
     */
    async summariseByAccount(scope: TxnSummaryScope): Promise<AccountSummaryRow[]> {
        const conditions = this.scopeConditions(scope, 'summariseByAccount');
        const rows = await this.db.select({
            accountId: statements.accountId,
            bankName: statements.bankName,
            accountLast4: statements.accountLast4,
            inCents: sql<number>`COALESCE(SUM(CASE WHEN ${statementTransactions.amountCents} > 0 THEN ${statementTransactions.amountCents} ELSE 0 END), 0)::bigint`,
            outCents: sql<number>`COALESCE(SUM(CASE WHEN ${statementTransactions.amountCents} < 0 THEN -${statementTransactions.amountCents} ELSE 0 END), 0)::bigint`,
            txnNetCents: sql<number>`COALESCE(SUM(${statementTransactions.amountCents}), 0)::bigint`,
            // Statement balances live on the parent statement (verification json).
            // Pick the earliest statement's opening and the latest's closing —
            // FILTER drops statements with no verified balance, ORDER picks by period.
            openingBalanceCents: sql<number | null>`(array_agg((${statements.verification} ->> 'openingBalanceCents')::bigint ORDER BY ${statements.periodStart} ASC NULLS LAST, ${statements.createdAt} ASC) FILTER (WHERE (${statements.verification} ->> 'openingBalanceCents') IS NOT NULL))[1]`,
            closingBalanceCents: sql<number | null>`(array_agg((${statements.verification} ->> 'closingBalanceCents')::bigint ORDER BY ${statements.periodEnd} DESC NULLS LAST, ${statements.createdAt} DESC) FILTER (WHERE (${statements.verification} ->> 'closingBalanceCents') IS NOT NULL))[1]`,
            minPeriodStart: sql<string | null>`MIN(${statements.periodStart})::text`,
            maxPeriodEnd: sql<string | null>`MAX(${statements.periodEnd})::text`,
            txnCount: sql<number>`COUNT(*)::int`,
            statementCount: sql<number>`COUNT(DISTINCT ${statementTransactions.statementId})::int`,
        })
            .from(statementTransactions)
            .innerJoin(statements, eq(statements.statementId, statementTransactions.statementId))
            .where(and(...conditions))
            .groupBy(statements.accountId, statements.bankName, statements.accountLast4)
            .orderBy(sql`COALESCE(SUM(${statementTransactions.amountCents}), 0) DESC`);

        interface Group {
            accountId: string | null; bankName: string | null; accountLast4: string | null;
            inCents: number; outCents: number; txnNetCents: number;
            openingBalanceCents: number | null; closingBalanceCents: number | null;
            minPeriodStart: string | null; maxPeriodEnd: string | null;
            txnCount: number; statementCount: number;
        }
        const groups: Group[] = rows.map((r) => ({
            accountId: r.accountId ?? null,
            bankName: r.bankName ?? null,
            accountLast4: r.accountLast4 ?? null,
            inCents: Number(r.inCents),
            outCents: Number(r.outCents),
            txnNetCents: Number(r.txnNetCents),
            openingBalanceCents: r.openingBalanceCents != null ? Number(r.openingBalanceCents) : null,
            closingBalanceCents: r.closingBalanceCents != null ? Number(r.closingBalanceCents) : null,
            minPeriodStart: r.minPeriodStart ?? null,
            maxPeriodEnd: r.maxPeriodEnd ?? null,
            txnCount: Number(r.txnCount),
            statementCount: Number(r.statementCount),
        }));

        // Grouping is by stable accountId, but legacy statements (processed
        // before the column existed) carry a null accountId. Merge each null
        // group into the identified group sharing its (bankName, last4) tuple
        // so one real account never renders as two cards mid-backfill.
        const identified = groups.filter((g) => g.accountId != null);
        const merged: Group[] = [...identified];
        for (const legacy of groups.filter((g) => g.accountId == null)) {
            const home = identified.find((g) =>
                g.bankName === legacy.bankName && g.accountLast4 === legacy.accountLast4);
            if (!home) { merged.push(legacy); continue; }
            home.inCents += legacy.inCents;
            home.outCents += legacy.outCents;
            home.txnNetCents += legacy.txnNetCents;
            home.txnCount += legacy.txnCount;
            home.statementCount += legacy.statementCount;
            // Bookends follow the periods: earliest opening, latest closing.
            if (legacy.openingBalanceCents != null && (home.openingBalanceCents == null
                || (legacy.minPeriodStart ?? '9999') < (home.minPeriodStart ?? '9999'))) {
                home.openingBalanceCents = legacy.openingBalanceCents;
            }
            if (legacy.closingBalanceCents != null && (home.closingBalanceCents == null
                || (legacy.maxPeriodEnd ?? '0000') > (home.maxPeriodEnd ?? '0000'))) {
                home.closingBalanceCents = legacy.closingBalanceCents;
            }
            if ((legacy.minPeriodStart ?? '9999') < (home.minPeriodStart ?? '9999')) home.minPeriodStart = legacy.minPeriodStart;
            if ((legacy.maxPeriodEnd ?? '0000') > (home.maxPeriodEnd ?? '0000')) home.maxPeriodEnd = legacy.maxPeriodEnd;
        }

        return merged
            .map((g) => ({
                accountId: g.accountId,
                bankName: g.bankName,
                accountLast4: g.accountLast4,
                inCents: g.inCents,
                outCents: g.outCents,
                // Balance-anchored net (closing − opening) when we have both; the
                // transaction sum is only the fallback.
                netCents: g.openingBalanceCents != null && g.closingBalanceCents != null
                    ? g.closingBalanceCents - g.openingBalanceCents : g.txnNetCents,
                openingBalanceCents: g.openingBalanceCents,
                closingBalanceCents: g.closingBalanceCents,
                txnCount: g.txnCount,
                statementCount: g.statementCount,
            }))
            .sort((a, b) => b.netCents - a.netCents);
    }

    /**
     * Categorisation-provenance rollup — what fraction of the money is
     * deterministic (rule/user/advisor), LLM-assigned, or uncategorised.
     * Makes the trust gaps in the semantic totals visible instead of hidden.
     */
    async summariseCoverage(scope: TxnSummaryScope): Promise<CoverageSummaryRow[]> {
        const conditions = this.scopeConditions(scope, 'summariseCoverage');
        const bucketExpr = sql`CASE
            WHEN ${statementTransactions.category} IS NULL OR ${statementTransactions.category} = 'UNCATEGORIZED' THEN 'UNCATEGORIZED'
            WHEN ${statementTransactions.categorySource} IN ('RULE', 'USER', 'ADVISOR') THEN 'DETERMINISTIC'
            ELSE 'AI'
        END`;
        const rows = await this.db.select({
            bucket: sql<string>`${bucketExpr}`,
            inCents: sql<number>`COALESCE(SUM(CASE WHEN ${statementTransactions.amountCents} > 0 THEN ${statementTransactions.amountCents} ELSE 0 END), 0)::bigint`,
            outCents: sql<number>`COALESCE(SUM(CASE WHEN ${statementTransactions.amountCents} < 0 THEN -${statementTransactions.amountCents} ELSE 0 END), 0)::bigint`,
            txnCount: sql<number>`COUNT(*)::int`,
            confirmedCount: sql<number>`SUM(CASE WHEN ${statementTransactions.reviewStatus} = 'CONFIRMED' THEN 1 ELSE 0 END)::int`,
        })
            .from(statementTransactions)
            .where(and(...conditions))
            .groupBy(bucketExpr);
        return rows.map((r) => ({
            bucket: r.bucket,
            inCents: Number(r.inCents),
            outCents: Number(r.outCents),
            txnCount: Number(r.txnCount),
            confirmedCount: Number(r.confirmedCount),
        }));
    }

    /**
     * TRANSFER-class rows for cross-statement pairing (a transfer is a debit
     * on one account and a credit on another). Transfers are a small subset,
     * but the cap bounds the worst case; date-ordered so greedy pairing is
     * deterministic.
     */
    async listTransferRows(
        scope: TxnSummaryScope,
        opts: { unpairedOnly?: boolean; excludeStatementId?: string; cap?: number } = {},
    ): Promise<TransferRow[]> {
        const conditions = this.scopeConditions(scope, 'listTransferRows');
        conditions.push(eq(statementTransactions.flowClass, 'TRANSFER'));
        if (opts.unpairedOnly) conditions.push(isNull(statementTransactions.transferPairId));
        if (opts.excludeStatementId) {
            conditions.push(ne(statementTransactions.statementId, opts.excludeStatementId));
        }
        const rows = await this.db.select({
            txnId: statementTransactions.txnId,
            statementId: statementTransactions.statementId,
            accountId: statements.accountId,
            txnDate: statementTransactions.txnDate,
            amountCents: statementTransactions.amountCents,
            description: statementTransactions.description,
        })
            .from(statementTransactions)
            .innerJoin(statements, eq(statements.statementId, statementTransactions.statementId))
            .where(and(...conditions))
            .orderBy(sql`COALESCE(${statementTransactions.txnDate}, ${EPOCH_DATE}::date)`, asc(statementTransactions.txnId))
            .limit(opts.cap ?? 2000);
        return rows.map((r) => ({
            txnId: r.txnId,
            statementId: r.statementId,
            accountId: (r.accountId as string | null) ?? null,
            txnDate: (r.txnDate as string | null) ?? null,
            amountCents: Number(r.amountCents),
            description: (r.description as string | null) ?? null,
        }));
    }

    /**
     * Existing non-duplicate rows of one account inside a date window — the
     * comparison set a fresh ingest dedupes against (same account, another
     * statement). Slim shape, capped; ordered for deterministic matching.
     */
    async listAccountRowsForDedupe(userId: string, accountId: string, opts: {
        dateFrom: string;
        dateTo: string;
        excludeStatementId?: string;
        cap?: number;
    }): Promise<DedupeCandidateRow[]> {
        const conditions: any[] = [
            eq(statementTransactions.userId, userId),
            eq(statements.accountId, accountId),
            isNull(statementTransactions.duplicateOfTxnId),
            sql`${statementTransactions.txnDate} >= ${opts.dateFrom}::date`,
            sql`${statementTransactions.txnDate} <= ${opts.dateTo}::date`,
        ];
        if (opts.excludeStatementId) {
            conditions.push(ne(statementTransactions.statementId, opts.excludeStatementId));
        }
        const rows = await this.db.select({
            txnId: statementTransactions.txnId,
            statementId: statementTransactions.statementId,
            txnDate: statementTransactions.txnDate,
            amountCents: statementTransactions.amountCents,
            description: statementTransactions.description,
        })
            .from(statementTransactions)
            .innerJoin(statements, eq(statements.statementId, statementTransactions.statementId))
            .where(and(...conditions))
            .orderBy(asc(statementTransactions.txnDate), asc(statementTransactions.txnId))
            .limit(opts.cap ?? 5000);
        return rows.map((r) => ({
            txnId: r.txnId,
            statementId: r.statementId,
            txnDate: (r.txnDate as string | null) ?? null,
            amountCents: Number(r.amountCents),
            description: (r.description as string | null) ?? null,
        }));
    }

    /**
     * Persist transfer-pair ids on EXISTING rows (the counterpart legs living
     * in other statements) — the fresh statement's own legs carry theirs
     * through the ingest upsert. Idempotent single UPDATE per chunk.
     */
    async setTransferPairIds(updates: Array<{ txnId: string; transferPairId: string }>): Promise<void> {
        const CHUNK = 200;
        for (let i = 0; i < updates.length; i += CHUNK) {
            const chunk = updates.slice(i, i + CHUNK);
            const values = sql.join(
                chunk.map((u) => sql`(${u.txnId}, ${u.transferPairId})`),
                sql`, `,
            );
            await this.db.execute(sql`
                UPDATE statement_transactions AS t
                SET transfer_pair_id = v.pair_id, updated_at = now()
                FROM (VALUES ${values}) AS v(txn_id, pair_id)
                WHERE t.txn_id = v.txn_id
            `);
        }
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
