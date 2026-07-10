import { and, eq, or, isNull, gte, lte, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { invoices, receipts, statements, statementTransactions } from '../pg/schema';

/** Inclusive YYYY-MM-DD bounds; omit both for a whole-of-business (lifetime) rollup. */
export interface ClientAggregateScope {
    orgId: string;
    dateFrom?: string;
    dateTo?: string;
}

/**
 * Whole-of-client financial rollup for the advisor Overview.
 * Income/expenses/GST follow the same definitions as the Reports tab (P&L + Tax):
 * income = invoiced total, expenses = business-apportioned receipts, GST = collected − credits.
 * All money is dollars (numeric); statement net is converted from integer cents.
 */
export interface ClientAggregate {
    income: number;
    incomeCollected: number;
    invoicesIssued: number;
    invoicesPaid: number;
    expenses: number;
    expensesCount: number;
    net: number;
    marginPct: number;
    gstCollected: number;
    gstCredits: number;
    gstNet: number;
    statementsCount: number;
    statementTxns: number;
    statementsNet: number;
    firstRecordDate: string | null;
}

export class AccountantReportingPgRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb {
        return this.injected ?? getPg();
    }

    /** SUM/COUNT across invoices + receipts + statements for one client org over an optional date range. */
    async clientAggregate(scope: ClientAggregateScope): Promise<ClientAggregate> {
        const { orgId, dateFrom, dateTo } = scope;
        if (!orgId) throw new Error('clientAggregate requires orgId');

        // ── Invoices (income): exclude recurring / quotes / payment-links, like profitLoss.ts ──
        const invConds: any[] = [
            eq(invoices.orgId, orgId),
            or(isNull(invoices.isRecurring), eq(invoices.isRecurring, false)),
            or(isNull(invoices.isQuote), eq(invoices.isQuote, false)),
            or(isNull(invoices.isPaymentLink), eq(invoices.isPaymentLink, false)),
        ];
        if (dateFrom) invConds.push(gte(invoices.date, dateFrom));
        if (dateTo) invConds.push(lte(invoices.date, dateTo));
        const [inv] = await this.db
            .select({
                invoiced: sql<string>`coalesce(sum(${invoices.totalAmount}), 0)`,
                collected: sql<string>`coalesce(sum(${invoices.paidAmount}), 0)`,
                gst: sql<string>`coalesce(sum(${invoices.gstAmount}), 0)`,
                issued: sql<number>`count(*)::int`,
                paid: sql<number>`coalesce(sum(case when ${invoices.paidAmount} >= ${invoices.totalAmount} and ${invoices.totalAmount} > 0 then 1 else 0 end), 0)::int`,
                firstDate: sql<string | null>`min(${invoices.date})`,
            })
            .from(invoices)
            .where(and(...invConds));

        // ── Receipts (expenses): business-apportioned, exclude ARCHIVED ──
        const recConds: any[] = [
            eq(receipts.orgId, orgId),
            or(isNull(receipts.status), sql`${receipts.status} <> 'ARCHIVED'`),
        ];
        if (dateFrom) recConds.push(gte(receipts.date, dateFrom));
        if (dateTo) recConds.push(lte(receipts.date, dateTo));
        const [rec] = await this.db
            .select({
                expenses: sql<string>`coalesce(sum(${receipts.totalAmount} * coalesce(${receipts.businessPercent}, 100) / 100), 0)`,
                gstCredits: sql<string>`coalesce(sum(coalesce(${receipts.gstAmount}, ${receipts.taxAmount}, 0) * coalesce(${receipts.businessPercent}, 100) / 100), 0)`,
                cnt: sql<number>`count(*)::int`,
                firstDate: sql<string | null>`min(${receipts.date})`,
            })
            .from(receipts)
            .where(and(...recConds));

        // ── Bank statement transactions (net cash + activity), org-scoped via statements ──
        const stConds: any[] = [
            sql`${statementTransactions.statementId} IN (SELECT ${statements.statementId} FROM ${statements} WHERE ${statements.organizationId} = ${orgId})`,
        ];
        if (dateFrom) stConds.push(sql`${statementTransactions.txnDate} >= ${dateFrom}::date`);
        if (dateTo) stConds.push(sql`${statementTransactions.txnDate} <= ${dateTo}::date`);
        const [st] = await this.db
            .select({
                netCents: sql<string>`coalesce(sum(${statementTransactions.amountCents}), 0)::bigint`,
                txns: sql<number>`count(*)::int`,
                stmts: sql<number>`count(distinct ${statementTransactions.statementId})::int`,
            })
            .from(statementTransactions)
            .where(and(...stConds));

        const income = Number(inv?.invoiced ?? 0);
        const expenses = Number(rec?.expenses ?? 0);
        const net = Math.round((income - expenses) * 100) / 100;
        const gstCollected = Number(inv?.gst ?? 0);
        const gstCredits = Number(rec?.gstCredits ?? 0);
        const firstDates = [inv?.firstDate, rec?.firstDate].filter(Boolean) as string[];
        const firstRecordDate = firstDates.length ? firstDates.sort()[0] : null;

        return {
            income,
            incomeCollected: Number(inv?.collected ?? 0),
            invoicesIssued: Number(inv?.issued ?? 0),
            invoicesPaid: Number(inv?.paid ?? 0),
            expenses,
            expensesCount: Number(rec?.cnt ?? 0),
            net,
            marginPct: income > 0 ? Math.round((net / income) * 100) : 0,
            gstCollected,
            gstCredits,
            gstNet: Math.round((gstCollected - gstCredits) * 100) / 100,
            statementsCount: Number(st?.stmts ?? 0),
            statementTxns: Number(st?.txns ?? 0),
            statementsNet: Math.round(Number(st?.netCents ?? 0)) / 100,
            firstRecordDate,
        };
    }
}
