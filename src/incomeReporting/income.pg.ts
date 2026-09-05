import { sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import type {
    IncomeCursor,
    IncomeListParams,
    IncomeListResult,
    IncomeInvoiceRow,
    IncomeMonthRow,
    IncomeOwedByResult,
    IncomeOwedByRow,
    IncomeScope,
    IncomeStatus,
    IncomeTotals,
} from './schema';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown): number => Number(v ?? 0);
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
    const a = Date.parse(`${from}T00:00:00Z`);
    const b = Date.parse(`${to}T00:00:00Z`);
    if (Number.isNaN(a) || Number.isNaN(b)) return 0;
    return Math.round((b - a) / 86_400_000);
}

/** Every calendar month ('YYYY-MM') overlapping the inclusive window. */
export function incomeMonths(dateFrom: string, dateTo: string): string[] {
    const [fy, fm] = dateFrom.slice(0, 7).split('-').map(Number);
    const [ty, tm] = dateTo.slice(0, 7).split('-').map(Number);
    if (!fy || !fm || !ty || !tm) return [];
    const out: string[] = [];
    let y = fy;
    let m = fm;
    while (y < ty || (y === ty && m <= tm)) {
        out.push(`${y}-${String(m).padStart(2, '0')}`);
        m += 1;
        if (m > 12) { m = 1; y += 1; }
    }
    return out;
}

/** A payment date we can safely cast to a date in SQL. */
const PAID_DATE_OK = sql`p.paid_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`;

/**
 * Postgres-only reporting repo for the Income screen (POSTGRES_MIGRATION_PLAN
 * §8, the BasReportingPgRepo precedent). There is no Dynamo twin: every figure
 * here is a SUM/COUNT/GROUP BY over invoices, their payments and their client,
 * so it reads Postgres regardless of the cutover flag.
 *
 * Nothing in this file returns an unbounded list. The page is keyset limited,
 * the month roll-up is one row per calendar month of the window, and the
 * "who still owes" answer is the top N plus one aggregate over the remainder,
 * so a business with ten thousand debtors costs the same as one with three.
 */
export class IncomeReportingPgRepo {
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

    /**
     * The set every figure on this screen is about: invoices ISSUED in the
     * window. Byte for byte the BAS predicate — drafts and voids never count,
     * and quotes, recurring templates and payment links are not invoices.
     */
    private windowConds(scope: IncomeScope) {
        return sql`
            i.org_id = ${scope.orgId}
            AND i.issue_date >= ${scope.dateFrom} AND i.issue_date <= ${scope.dateTo}
            AND i.status IN ('SENT', 'PARTIAL', 'OVERDUE', 'PAID')
            AND (i.is_quote IS NULL OR i.is_quote = false)
            AND (i.is_recurring IS NULL OR i.is_recurring = false)
            AND (i.is_payment_link IS NULL OR i.is_payment_link = false)`;
    }

    /** Settled in full: the stored status says so, or the money says so. */
    private settled() {
        return sql`(i.status = 'PAID' OR (coalesce(i.total_amount, 0) > 0
            AND coalesce(i.paid_amount, 0) >= coalesce(i.total_amount, 0)))`;
    }

    private pastDue(today: string) {
        return sql`(i.due_date IS NOT NULL AND i.due_date < ${today})`;
    }

    /**
     * PAID beats PART_PAID beats OVERDUE. An invoice with part of the money
     * against it reads PART_PAID even once its due date has passed, which is
     * why `overdueCount` counts past-due unsettled invoices instead of rows
     * carrying this status.
     */
    private statusExpr(today: string) {
        return sql`CASE
            WHEN ${this.settled()} THEN 'PAID'
            WHEN coalesce(i.paid_amount, 0) > 0 THEN 'PART_PAID'
            WHEN ${this.pastDue(today)} THEN 'OVERDUE'
            ELSE 'SENT' END`;
    }

    /** One page of invoices issued in the window, newest issue date first. */
    async listIssued(params: IncomeListParams): Promise<IncomeListResult> {
        const { orgId, today, limit = 20, cursor, search, status } = params;
        if (!orgId) throw new Error('IncomeReportingPgRepo.listIssued requires orgId');
        const size = Math.min(Math.max(Math.floor(limit) || 20, 1), 100);

        const conds: any[] = [this.windowConds(params)];
        if (status) conds.push(sql`${this.statusExpr(today)} = ${status}`);
        if (search) {
            const like = `%${search}%`;
            conds.push(sql`(i.invoice_number ILIKE ${like} OR c.name ILIKE ${like})`);
        }
        if (cursor) {
            conds.push(sql`(i.issue_date < ${cursor.issueDate}
                OR (i.issue_date = ${cursor.issueDate} AND i.invoice_id < ${cursor.invoiceId}))`);
        }
        const where = conds.reduce((acc, c, idx) => (idx === 0 ? c : sql`${acc} AND ${c}`));

        const rows = await this.many(sql`
            SELECT i.invoice_id, i.invoice_number, i.client_id, c.name AS client_name,
                   i.issue_date, i.due_date,
                   ${this.statusExpr(today)} AS derived_status,
                   lp.last_paid,
                   coalesce(i.paid_amount, 0)::text AS paid_amount,
                   coalesce(i.gst_amount, 0)::text AS gst_amount,
                   coalesce(i.total_amount, 0)::text AS total_amount
            FROM invoices i
            LEFT JOIN clients c ON c.client_id = i.client_id
            LEFT JOIN LATERAL (
                SELECT max(p.paid_date) AS last_paid
                FROM invoice_payments p
                WHERE p.invoice_id = i.invoice_id AND ${PAID_DATE_OK}
            ) lp ON true
            WHERE ${where}
            ORDER BY i.issue_date DESC, i.invoice_id DESC
            LIMIT ${size + 1}`);

        const page = rows.slice(0, size);
        const items = page.map((r) => this.toRow(r, today));
        const last = page[page.length - 1];
        const nextCursor: IncomeCursor | null = rows.length > size && last
            ? { issueDate: String(last.issue_date), invoiceId: String(last.invoice_id) }
            : null;
        return { items, nextCursor };
    }

    private toRow(r: any, today: string): IncomeInvoiceRow {
        const status = String(r.derived_status) as IncomeStatus;
        const issueDate = String(r.issue_date);
        const paidDate = text(r.last_paid);
        const dueDate = text(r.due_date);
        return {
            invoiceId: String(r.invoice_id),
            invoiceNumber: String(r.invoice_number ?? ''),
            clientId: text(r.client_id),
            clientName: text(r.client_name),
            issueDate,
            dueDate,
            status,
            paidDate,
            daysToPay: paidDate ? daysBetween(issueDate, paidDate) : null,
            daysPastDue: status === 'OVERDUE' && dueDate ? daysBetween(dueDate, today) : null,
            paidAmount: round2(num(r.paid_amount)),
            gstAmount: round2(num(r.gst_amount)),
            totalAmount: round2(num(r.total_amount)),
        };
    }

    /**
     * The window's figures, over the whole set rather than a page. Not
     * narrowed by search or status on purpose: `gstOnIssued` is label 1A, and
     * 1A cannot move because somebody typed in the search box.
     */
    async totals(scope: IncomeScope): Promise<IncomeTotals> {
        if (!scope.orgId) throw new Error('IncomeReportingPgRepo.totals requires orgId');
        const settled = this.settled();
        const owed = sql`coalesce(i.total_amount, 0) - coalesce(i.paid_amount, 0)`;
        const r = await this.one(sql`
            SELECT count(*)::int AS invoice_count,
                   coalesce(sum(coalesce(i.total_amount, 0)), 0)::text AS invoiced,
                   coalesce(sum(coalesce(i.paid_amount, 0)), 0)::text AS received,
                   coalesce(sum(coalesce(i.gst_amount, 0)), 0)::text AS gst_on_issued,
                   (count(*) FILTER (WHERE ${settled}))::int AS paid_count,
                   coalesce(sum(${owed}) FILTER (WHERE NOT ${settled}), 0)::text AS still_owed,
                   (count(*) FILTER (WHERE NOT ${settled}))::int AS owed_count,
                   (count(*) FILTER (WHERE NOT ${settled} AND ${this.pastDue(scope.today)}))::int AS overdue_count,
                   (avg(lp.last_paid::date - i.issue_date::date)
                       FILTER (WHERE ${settled} AND lp.last_paid IS NOT NULL))::text AS avg_days_to_pay
            FROM invoices i
            LEFT JOIN LATERAL (
                SELECT max(p.paid_date) AS last_paid
                FROM invoice_payments p
                WHERE p.invoice_id = i.invoice_id AND ${PAID_DATE_OK}
            ) lp ON true
            WHERE ${this.windowConds(scope)}`);

        const avg = r.avg_days_to_pay;
        return {
            invoiced: round2(num(r.invoiced)),
            invoiceCount: num(r.invoice_count),
            received: round2(num(r.received)),
            paidCount: num(r.paid_count),
            stillOwed: round2(num(r.still_owed)),
            owedCount: num(r.owed_count),
            overdueCount: num(r.overdue_count),
            gstOnIssued: round2(num(r.gst_on_issued)),
            averageDaysToPay: avg === null || avg === undefined ? null : Math.round(num(avg)),
        };
    }

    /**
     * Invoiced against received, one row per calendar month of the window.
     * Grouped by the month the invoice was ISSUED, not the month the money
     * landed, so the pale bar and the solid part of it describe the same
     * invoices. Months with nothing in them are filled here rather than by a
     * caller, so the chart never has a hole where a quiet month was.
     */
    async byMonth(scope: IncomeScope): Promise<IncomeMonthRow[]> {
        if (!scope.orgId) throw new Error('IncomeReportingPgRepo.byMonth requires orgId');
        const rows = await this.many(sql`
            SELECT substr(i.issue_date, 1, 7) AS month,
                   coalesce(sum(coalesce(i.total_amount, 0)), 0)::text AS invoiced,
                   coalesce(sum(coalesce(i.paid_amount, 0)), 0)::text AS received
            FROM invoices i
            WHERE ${this.windowConds(scope)}
            GROUP BY 1`);

        const found = new Map<string, IncomeMonthRow>();
        for (const r of rows) {
            found.set(String(r.month), {
                month: String(r.month),
                invoiced: round2(num(r.invoiced)),
                received: round2(num(r.received)),
            });
        }
        return incomeMonths(scope.dateFrom, scope.dateTo).map(
            (month) => found.get(month) ?? { month, invoiced: 0, received: 0 },
        );
    }

    /**
     * Who still owes, largest first, plus one aggregate over everybody past
     * the top `top`. Ranked and counted inside the query, so the answer is
     * `top + 1` rows however many clients there are. Invoices with no client
     * fall into a single null bucket rather than one bucket each.
     */
    async owedBy(scope: IncomeScope, top = 3): Promise<IncomeOwedByResult> {
        if (!scope.orgId) throw new Error('IncomeReportingPgRepo.owedBy requires orgId');
        const size = Math.min(Math.max(Math.floor(top) || 3, 1), 25);
        const rows = await this.many(sql`
            WITH owed AS (
                SELECT i.client_id,
                       count(*)::int AS invoices,
                       sum(coalesce(i.total_amount, 0) - coalesce(i.paid_amount, 0)) AS amount,
                       (count(*) FILTER (WHERE ${this.pastDue(scope.today)}))::int AS overdue
                FROM invoices i
                WHERE ${this.windowConds(scope)} AND NOT ${this.settled()}
                GROUP BY i.client_id
            ), ranked AS (
                SELECT o.*,
                       row_number() OVER (ORDER BY o.amount DESC, o.client_id ASC NULLS LAST) AS rn,
                       (count(*) OVER ())::int AS client_total,
                       sum(o.amount) OVER () AS owed_total
                FROM owed o
            )
            SELECT r.client_id, c.name AS client_name, r.invoices, r.overdue,
                   r.amount::text AS amount, r.client_total, r.owed_total::text AS owed_total
            FROM ranked r
            LEFT JOIN clients c ON c.client_id = r.client_id
            WHERE r.rn <= ${size}
            ORDER BY r.rn`);

        const topRows: IncomeOwedByRow[] = rows.map((r) => ({
            clientId: text(r.client_id),
            clientName: text(r.client_name),
            amount: round2(num(r.amount)),
            invoices: num(r.invoices),
            overdue: num(r.overdue),
        }));
        const clientTotal = rows.length > 0 ? num(rows[0].client_total) : 0;
        const owedTotal = rows.length > 0 ? num(rows[0].owed_total) : 0;
        const topAmount = topRows.reduce((sum, r) => sum + r.amount, 0);
        return {
            top: topRows,
            other: {
                clients: Math.max(clientTotal - topRows.length, 0),
                amount: round2(Math.max(owedTotal - topAmount, 0)),
            },
        };
    }
}
