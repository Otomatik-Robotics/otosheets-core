import { sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { unmatchedIncomeStatementPredicate, unmatchedIncomeFeedPredicate } from '../ledgerMatch/unmatchedIncome';
import type { BasInputs, BasInputsScope } from './schema';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown): number => Number(v ?? 0);

/** How many invoice ids `paidWithoutBankCreditIds` carries at most. */
export const UNATTRIBUTED_IDS_CAP = 200;

/** Every calendar month ('YYYY-MM') overlapping the inclusive window. */
export function monthsInWindow(dateFrom: string, dateTo: string): string[] {
    const [fy, fm] = dateFrom.slice(0, 7).split('-').map(Number);
    const [ty, tm] = dateTo.slice(0, 7).split('-').map(Number);
    if (!fy || !fm || !ty || !tm) return [];
    const out: string[] = [];
    let y = fy, m = fm;
    while (y < ty || (y === ty && m <= tm)) {
        out.push(`${y}-${String(m).padStart(2, '0')}`);
        m++;
        if (m > 12) { m = 1; y++; }
    }
    return out;
}

/** Which of `months` at least one [start, end] period (YYYY-MM-DD) overlaps. */
export function monthsCoveredBy(months: string[], periods: Array<{ start: string; end: string }>): Set<string> {
    const covered = new Set<string>();
    for (const month of months) {
        const monthStart = `${month}-01`;
        const monthEnd = `${month}-31`; // lexical upper bound — every real day of the month sorts below it
        if (periods.some((p) => p.start <= monthEnd && p.end >= monthStart)) covered.add(month);
    }
    return covered;
}

/**
 * Postgres-only reporting repo for the BAS view (POSTGRES_MIGRATION_PLAN.md
 * §8). Like AccountantReportingPgRepo there is no Dynamo twin: every figure
 * here is a SUM/COUNT across invoices, receipts, trips, bank rows and assets
 * for one window, and it reads Postgres regardless of the cutover flag.
 */
export class BasReportingPgRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    private async one(query: ReturnType<typeof sql>): Promise<any> {
        const res: any = await this.db.execute(query);
        const rows = (res?.rows ?? res) as any[];
        return rows[0] ?? {};
    }

    private async many(query: ReturnType<typeof sql>): Promise<any[]> {
        const res: any = await this.db.execute(query);
        return (res?.rows ?? res) as any[];
    }

    /** Everything `composeConfidence` and the BAS figures need, for one org and window. */
    async inputs(scope: BasInputsScope): Promise<BasInputs> {
        const { orgId, dateFrom, dateTo } = scope;
        if (!orgId) throw new Error('BasReportingPgRepo.inputs requires orgId');

        // ── Invoices: real invoices issued in the window. Drafts and voids never count. ──
        const invoiceWindow = sql`
            i.org_id = ${orgId}
            AND i.issue_date >= ${dateFrom} AND i.issue_date <= ${dateTo}
            AND i.status IN ('SENT', 'PARTIAL', 'OVERDUE', 'PAID')
            AND (i.is_quote IS NULL OR i.is_quote = false)
            AND (i.is_recurring IS NULL OR i.is_recurring = false)
            AND (i.is_payment_link IS NULL OR i.is_payment_link = false)`;
        const invoicesQ = this.one(sql`
            SELECT count(*)::int AS count,
                   coalesce(sum(i.gst_amount), 0)::text AS gst_collected,
                   coalesce(sum(i.subtotal), 0)::text AS sales_ex_gst,
                   (count(*) FILTER (WHERE i.status IN ('PAID', 'PARTIAL')))::int AS paid_count
            FROM invoices i
            WHERE ${invoiceWindow}`);
        // Paid, but the bank cannot show the money arriving and Stripe did not collect it.
        const unattributedQ = this.many(sql`
            SELECT i.invoice_id, count(*) OVER ()::int AS total
            FROM invoices i
            WHERE ${invoiceWindow}
              AND i.status IN ('PAID', 'PARTIAL')
              AND i.stripe_session_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM invoice_payments p
                              WHERE p.invoice_id = i.invoice_id AND p.stripe_payment_intent_id IS NOT NULL)
              AND NOT EXISTS (SELECT 1 FROM statement_transactions st WHERE st.matched_invoice_id = i.invoice_id)
              AND NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.matched_invoice_id = i.invoice_id)
            ORDER BY i.issue_date DESC, i.invoice_id DESC
            LIMIT ${UNATTRIBUTED_IDS_CAP}`);

        // ── Receipts: dated in the window, DUPLICATE/ARCHIVED excluded (an archived duplicate counts once). ──
        const share = sql`(coalesce(r.business_percent, 100) / 100)`;
        const gstOnReceipt = sql`coalesce(r.tax_amount, r.gst_amount, 0)`;
        const exGst = sql`coalesce(r.ex_gst_amount, r.total_amount - ${gstOnReceipt}, 0)`;
        // A HIGH flag the owner has acknowledged (reviewed_at) is history, not an exception —
        // otherwise a confirmed receipt could never leave the exception set.
        const exception = sql`(
            r.possible_duplicate_of IS NOT NULL
            OR (upper(r.ai_risk_level) = 'HIGH' AND r.reviewed_at IS NULL)
            OR r.category IS NULL OR upper(r.category) = 'UNCATEGORIZED'
            OR r.total_amount IS NULL OR r.total_amount = 0
            OR r.status ILIKE '%FAIL%')`;
        const receiptsQ = this.one(sql`
            SELECT count(*)::int AS count,
                   coalesce(sum(${gstOnReceipt} * ${share}), 0)::text AS gst_paid,
                   coalesce(sum(CASE WHEN r.asset_id IS NOT NULL THEN ${gstOnReceipt} * ${share} ELSE 0 END), 0)::text AS capital_gst_paid,
                   (count(*) FILTER (WHERE r.asset_id IS NULL))::int AS non_capital_count,
                   coalesce(sum(CASE WHEN r.asset_id IS NULL THEN ${exGst} * ${share} ELSE 0 END), 0)::text AS expenses_ex_gst,
                   coalesce(sum(CASE WHEN r.asset_id IS NOT NULL THEN ${exGst} * ${share} ELSE 0 END), 0)::text AS capital_ex_gst,
                   (count(*) FILTER (WHERE NOT (r.opened_at IS NOT NULL AND r.category_confirmed_at IS NOT NULL AND NOT ${exception})))::int AS unreviewed,
                   (count(*) FILTER (WHERE r.opened_at IS NULL))::int AS not_opened,
                   (count(*) FILTER (WHERE r.category_confirmed_at IS NULL))::int AS category_unconfirmed,
                   (count(*) FILTER (WHERE ${exception}))::int AS in_exception,
                   (count(*) FILTER (WHERE r.possible_duplicate_of IS NOT NULL))::int AS ex_possible_duplicate,
                   (count(*) FILTER (WHERE r.status ILIKE '%FAIL%'))::int AS ex_extraction_failed,
                   (count(*) FILTER (WHERE upper(r.ai_risk_level) = 'HIGH' AND r.reviewed_at IS NULL))::int AS ex_high_risk,
                   (count(*) FILTER (WHERE r.category IS NULL OR upper(r.category) = 'UNCATEGORIZED'))::int AS ex_uncategorised,
                   (count(*) FILTER (WHERE r.total_amount IS NULL OR r.total_amount = 0))::int AS ex_no_amount
            FROM receipts r
            WHERE r.org_id = ${orgId}
              AND r.receipt_date >= ${dateFrom} AND r.receipt_date <= ${dateTo}
              AND (r.status IS NULL OR r.status NOT IN ('DUPLICATE', 'ARCHIVED'))`);

        // ── Trips ──
        // Only WORK trips. The cents-per-kilometre deduction is for business
        // travel, so a personal trip and one whose purpose was never set are
        // both excluded; counting them over-claims the deduction, and the trips
        // summary screen already reports the same split.
        const tripsQ = this.one(sql`
            SELECT count(*)::int AS count, coalesce(sum(t.distance_km), 0)::text AS km
            FROM trips t
            WHERE t.org_id = ${orgId} AND t.trip_date >= ${dateFrom} AND t.trip_date <= ${dateTo}
              AND upper(coalesce(t.purpose, '')) = 'WORK'`);

        // ── Bank coverage: statement periods overlapping the window, and whether a live feed is on. ──
        const periodsQ = this.many(sql`
            SELECT s.period_start::text AS start, s.period_end::text AS "end"
            FROM statements s
            WHERE s.organization_id = ${orgId}
              AND s.duplicate_of_statement_id IS NULL
              AND s.period_start IS NOT NULL AND s.period_end IS NOT NULL
              AND s.period_end >= ${dateFrom}::date AND s.period_start <= ${dateTo}::date
            LIMIT 500`);
        const feedQ = this.one(sql`
            SELECT EXISTS (SELECT 1 FROM bank_accounts ba
                           WHERE ba.organization_id = ${orgId} AND ba.status = 'ACTIVE') AS active`);

        // ── Bank rows: statement + feed rows in the window, duplicates and transfer legs excluded. ──
        // NOTE: coalesce on category_source — a NULL would make the NOT(...) NULL and drop the row from the count.
        const reconciled = sql`(b.matched_invoice_id IS NOT NULL OR b.matched_receipt_id IS NOT NULL
            OR (b.review_status = 'CONFIRMED' AND coalesce(b.category_source, '') IN ('USER', 'ADVISOR')))`;
        const bankRowsQ = this.one(sql`
            WITH bank_rows AS (
                SELECT st.amount_cents, st.matched_invoice_id, st.matched_receipt_id, st.review_status, st.category_source,
                       coalesce(${unmatchedIncomeStatementPredicate('st')}, false) AS unmatched_credit
                FROM statement_transactions st
                JOIN statements s ON s.statement_id = st.statement_id
                WHERE s.organization_id = ${orgId}
                  AND s.duplicate_of_statement_id IS NULL
                  AND st.txn_date >= ${dateFrom}::date AND st.txn_date <= ${dateTo}::date
                  AND st.duplicate_of_txn_id IS NULL
                  AND st.transfer_pair_id IS NULL
                UNION ALL
                SELECT bt.amount_cents, bt.matched_invoice_id, bt.matched_receipt_id, bt.review_status, bt.category_source,
                       coalesce(${unmatchedIncomeFeedPredicate('bt')}, false) AS unmatched_credit
                FROM bank_transactions bt
                WHERE bt.organization_id = ${orgId}
                  AND bt.txn_date >= ${dateFrom}::date AND bt.txn_date <= ${dateTo}::date
                  AND bt.duplicate_of_txn_id IS NULL
            )
            SELECT count(*)::int AS rows_total,
                   (count(*) FILTER (WHERE NOT ${reconciled}))::int AS unreconciled,
                   (count(*) FILTER (WHERE b.unmatched_credit))::int AS unmatched_credits,
                   coalesce(sum(b.amount_cents) FILTER (WHERE b.unmatched_credit), 0)::bigint AS unmatched_credits_cents
            FROM bank_rows b`);

        // ── Assets ──
        const assetsQ = this.one(sql`
            SELECT (count(*) FILTER (WHERE a.status = 'ACTIVE'))::int AS active,
                   (count(*) FILTER (WHERE a.status = 'ACTIVE' AND a.first_used_date IS NULL))::int AS no_first_use
            FROM assets a
            WHERE a.org_id = ${orgId}`);

        const [inv, unattributed, rec, trips, periods, feed, bank, assets] = await Promise.all([
            invoicesQ, unattributedQ, receiptsQ, tripsQ, periodsQ, feedQ, bankRowsQ, assetsQ,
        ]);

        const months = monthsInWindow(dateFrom, dateTo);
        const feedActive = feed.active === true || feed.active === 't';
        const covered = feedActive
            ? new Set(months)
            : monthsCoveredBy(months, periods.map((p) => ({ start: String(p.start), end: String(p.end) })));
        const monthsMissing = months.filter((m) => !covered.has(m));

        return {
            window: { dateFrom, dateTo },
            invoices: {
                count: num(inv.count),
                gstCollected: round2(num(inv.gst_collected)),
                salesExGst: round2(num(inv.sales_ex_gst)),
                paidCount: num(inv.paid_count),
                paidWithoutBankCredit: unattributed.length > 0 ? num(unattributed[0].total) : 0,
                paidWithoutBankCreditIds: unattributed.map((r) => String(r.invoice_id)),
            },
            receipts: {
                count: num(rec.count),
                gstPaid: round2(num(rec.gst_paid)),
                capitalGstPaid: round2(num(rec.capital_gst_paid)),
                nonCapitalCount: num(rec.non_capital_count),
                expensesExGst: round2(num(rec.expenses_ex_gst)),
                capitalExGst: round2(num(rec.capital_ex_gst)),
                unreviewed: num(rec.unreviewed),
                notOpened: num(rec.not_opened),
                categoryUnconfirmed: num(rec.category_unconfirmed),
                inException: num(rec.in_exception),
                exception: {
                    possibleDuplicate: num(rec.ex_possible_duplicate),
                    extractionFailed: num(rec.ex_extraction_failed),
                    highRisk: num(rec.ex_high_risk),
                    uncategorised: num(rec.ex_uncategorised),
                    noAmount: num(rec.ex_no_amount),
                },
            },
            trips: { count: num(trips.count), km: round2(num(trips.km)) },
            bank: {
                hasStatement: covered.size > 0,
                feedActive,
                monthsInWindow: months.length,
                monthsCovered: covered.size,
                monthsMissing,
                rowsTotal: num(bank.rows_total),
                unreconciledRows: num(bank.unreconciled),
                unmatchedCredits: num(bank.unmatched_credits),
                unmatchedCreditsAmount: round2(num(bank.unmatched_credits_cents) / 100),
            },
            assets: { count: num(assets.active), withoutFirstUse: num(assets.no_first_use) },
        };
    }

    /**
     * Every org, a page at a time — for the BAS reminder cron, which must
     * walk ALL orgs (not only those with an advisor link). Keyset on org_id
     * ascending; `nextAfterOrgId` is null on the last page.
     */
    async listOrgIdsPaged(opts: { limit: number; afterOrgId?: string | null }): Promise<{ orgIds: string[]; nextAfterOrgId: string | null }> {
        const limit = Math.min(Math.max(Math.floor(opts.limit) || 1, 1), 500);
        const rows = await this.many(sql`
            SELECT o.org_id FROM orgs o
            ${opts.afterOrgId ? sql`WHERE o.org_id > ${opts.afterOrgId}` : sql``}
            ORDER BY o.org_id ASC
            LIMIT ${limit + 1}`);
        const page = rows.slice(0, limit).map((r) => String(r.org_id));
        return {
            orgIds: page,
            nextAfterOrgId: rows.length > limit ? page[page.length - 1] : null,
        };
    }
}
