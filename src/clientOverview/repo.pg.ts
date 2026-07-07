import { and, eq, sql, desc, inArray } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { invoices, invoicePayments, clients } from '../pg/schema/billingCore';
import { jobs } from '../pg/schema/opsEntities';
import { ClientPgRepo } from '../client/repo.pg';
import type {
    ClientOverview,
    ClientOverviewInvoice,
    ClientRollup,
    ClientTimelineEvent,
} from './schema';

// How many rows each timeline source contributes before the merged list is capped.
const SOURCE_LIMIT = 12;
const TIMELINE_LIMIT = 15;
const RECENT_INVOICES = 6;

/**
 * Postgres-only reporting repo for the per-client cockpit (POSTGRES_MIGRATION_PLAN.md §8).
 *
 * Every figure is derived live with SQL aggregation over the billing-core (invoices,
 * invoice_payments) and ops (jobs) tables — no in-Lambda aggregation, no snapshots.
 * There is no Dynamo implementation by design: this projection is meaningful only once
 * the financial core is in Postgres, and it reads Postgres regardless of the cutover
 * flag. Its completeness therefore tracks the billing-core / ops backfill state.
 */
export class ClientOverviewPgRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    async getClientOverview(orgId: string, clientId: string): Promise<ClientOverview | null> {
        const client = await new ClientPgRepo(this.injected).getClient(orgId, clientId);
        if (!client) return null;

        const today = new Date().toISOString().slice(0, 10);

        // Real invoices only — exclude payment links and quotes from every money figure.
        const realInvoice = and(
            eq(invoices.orgId, orgId),
            eq(invoices.clientId, clientId),
            sql`(${invoices.isPaymentLink} IS NULL OR ${invoices.isPaymentLink} = false)`,
            sql`(${invoices.isQuote} IS NULL OR ${invoices.isQuote} = false)`,
        );
        // "Open" = billed but not settled. DRAFT/VOID owe nothing.
        const openStatus = sql`${invoices.status} IN ('SENT', 'PARTIAL', 'OVERDUE')`;
        const owedExpr = sql`(coalesce(${invoices.totalAmount}, 0) - coalesce(${invoices.paidAmount}, 0))`;

        const [agg] = await this.db
            .select({
                invoiceCount: sql<number>`count(*)::int`,
                paidInvoiceCount: sql<number>`(count(*) filter (where ${invoices.status} = 'PAID'))::int`,
                lifetimeValue: sql<string>`coalesce(sum(${invoices.paidAmount}), 0)`,
                outstanding: sql<string>`coalesce(sum(${owedExpr}) filter (where ${openStatus}), 0)`,
                overdue: sql<string>`coalesce(sum(${owedExpr}) filter (where ${openStatus} and ${invoices.dueDate} is not null and ${invoices.dueDate} < ${today}), 0)`,
            })
            .from(invoices)
            .where(realInvoice);

        const avgPayDays = await this.avgPayDays(orgId, clientId);

        const recentInvoices = await this.recentInvoices(orgId, clientId);
        const timeline = await this.timeline(orgId, clientId, client.createdAt, client.name);

        return {
            client,
            kpis: {
                lifetimeValue: Number(agg?.lifetimeValue) || 0,
                outstanding: Number(agg?.outstanding) || 0,
                overdue: Number(agg?.overdue) || 0,
                invoiceCount: agg?.invoiceCount ?? 0,
                paidInvoiceCount: agg?.paidInvoiceCount ?? 0,
                avgPayDays,
            },
            recentInvoices,
            timeline,
        };
    }

    /**
     * Per-client money rollup for a page of list rows — one GROUP BY over the given
     * client ids, never a query per row. Clients with no real invoices are simply
     * absent from the result (the caller treats a miss as all-zero / "quiet").
     */
    async batchClientRollups(orgId: string, clientIds: string[]): Promise<ClientRollup[]> {
        const ids = [...new Set(clientIds.filter(Boolean))];
        if (ids.length === 0) return [];

        const today = new Date().toISOString().slice(0, 10);
        const openStatus = sql`${invoices.status} IN ('SENT', 'PARTIAL', 'OVERDUE')`;
        const owed = sql`(coalesce(${invoices.totalAmount}, 0) - coalesce(${invoices.paidAmount}, 0))`;

        const rows = await this.db
            .select({
                clientId: invoices.clientId,
                invoiceCount: sql<number>`count(*)::int`,
                paidInvoiceCount: sql<number>`(count(*) filter (where ${invoices.status} = 'PAID'))::int`,
                lifetimeValue: sql<string>`coalesce(sum(${invoices.paidAmount}), 0)`,
                outstanding: sql<string>`coalesce(sum(${owed}) filter (where ${openStatus}), 0)`,
                overdue: sql<string>`coalesce(sum(${owed}) filter (where ${openStatus} and ${invoices.dueDate} is not null and ${invoices.dueDate} < ${today}), 0)`,
            })
            .from(invoices)
            .where(and(
                eq(invoices.orgId, orgId),
                inArray(invoices.clientId, ids),
                sql`(${invoices.isPaymentLink} IS NULL OR ${invoices.isPaymentLink} = false)`,
                sql`(${invoices.isQuote} IS NULL OR ${invoices.isQuote} = false)`,
            ))
            .groupBy(invoices.clientId);

        return (rows as any[])
            .filter((r) => r.clientId)
            .map((r) => ({
                clientId: r.clientId as string,
                outstanding: Number(r.outstanding) || 0,
                overdue: Number(r.overdue) || 0,
                invoiceCount: r.invoiceCount || 0,
                paidInvoiceCount: r.paidInvoiceCount || 0,
                lifetimeValue: Number(r.lifetimeValue) || 0,
            }));
    }

    /**
     * Mean days from issue date to the final payment across this client's paid invoices.
     * issue_date / paid_date are TEXT (exact strings from Dynamo), so we take the leading
     * yyyy-mm-dd and guard the cast with a regex to survive any legacy junk. Isolated in
     * its own try/catch — a date-shaped surprise degrades this one KPI to null, never the
     * whole overview.
     */
    private async avgPayDays(orgId: string, clientId: string): Promise<number | null> {
        try {
            const res: any = await this.db.execute(sql`
                select avg(diff)::float as avg_pay_days from (
                    select (left(mp.last_paid, 10)::date - left(i.issue_date, 10)::date) as diff
                    from invoices i
                    join (
                        select invoice_id, max(paid_date) as last_paid
                        from invoice_payments
                        where org_id = ${orgId} and paid_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                        group by invoice_id
                    ) mp on mp.invoice_id = i.invoice_id
                    where i.org_id = ${orgId}
                      and i.client_id = ${clientId}
                      and i.status = 'PAID'
                      and i.issue_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                ) d
            `);
            const rows = (res?.rows ?? res) as any[];
            const v = rows?.[0]?.avg_pay_days;
            return v == null ? null : Math.round(Number(v));
        } catch {
            return null;
        }
    }

    private async recentInvoices(orgId: string, clientId: string): Promise<ClientOverviewInvoice[]> {
        const rows = await this.db
            .select({
                invoiceId: invoices.invoiceId,
                invoiceNumber: invoices.invoiceNumber,
                status: invoices.status,
                totalAmount: invoices.totalAmount,
                paidAmount: invoices.paidAmount,
                date: invoices.date,
                dueDate: invoices.dueDate,
                createdAt: invoices.createdAt,
            })
            .from(invoices)
            .where(and(
                eq(invoices.orgId, orgId),
                eq(invoices.clientId, clientId),
                sql`(${invoices.isPaymentLink} IS NULL OR ${invoices.isPaymentLink} = false)`,
                sql`(${invoices.isQuote} IS NULL OR ${invoices.isQuote} = false)`,
            ))
            .orderBy(desc(invoices.createdAt))
            .limit(RECENT_INVOICES);

        return rows.map((r: any) => ({
            invoiceId: r.invoiceId,
            invoiceNumber: r.invoiceNumber,
            status: r.status ?? null,
            totalAmount: Number(r.totalAmount) || 0,
            paidAmount: Number(r.paidAmount) || 0,
            date: r.date ?? null,
            dueDate: r.dueDate ?? null,
            createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        }));
    }

    private async timeline(
        orgId: string,
        clientId: string,
        clientCreatedAt: string,
        clientName: string,
    ): Promise<ClientTimelineEvent[]> {
        const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));
        const events: ClientTimelineEvent[] = [];

        // Invoice created
        const inv = await this.db
            .select({
                invoiceId: invoices.invoiceId,
                invoiceNumber: invoices.invoiceNumber,
                totalAmount: invoices.totalAmount,
                createdAt: invoices.createdAt,
            })
            .from(invoices)
            .where(and(
                eq(invoices.orgId, orgId),
                eq(invoices.clientId, clientId),
                sql`(${invoices.isPaymentLink} IS NULL OR ${invoices.isPaymentLink} = false)`,
            ))
            .orderBy(desc(invoices.createdAt))
            .limit(SOURCE_LIMIT);
        for (const r of inv as any[]) {
            events.push({
                id: `inv_${r.invoiceId}`,
                type: 'invoice_created',
                title: `Invoice ${r.invoiceNumber} created`,
                amount: Number(r.totalAmount) || 0,
                at: iso(r.createdAt),
                refId: r.invoiceId,
            });
        }

        // Payment received (join payments to invoices to scope by client)
        const pay = await this.db
            .select({
                paymentId: invoicePayments.paymentId,
                amount: invoicePayments.amount,
                createdAt: invoicePayments.createdAt,
                invoiceNumber: invoices.invoiceNumber,
            })
            .from(invoicePayments)
            .innerJoin(invoices, eq(invoicePayments.invoiceId, invoices.invoiceId))
            .where(and(eq(invoices.orgId, orgId), eq(invoices.clientId, clientId)))
            .orderBy(desc(invoicePayments.createdAt))
            .limit(SOURCE_LIMIT);
        for (const r of pay as any[]) {
            events.push({
                id: `pay_${r.paymentId}`,
                type: 'payment_received',
                title: `Payment received — Invoice ${r.invoiceNumber}`,
                amount: Number(r.amount) || 0,
                at: iso(r.createdAt),
                refId: r.paymentId,
            });
        }

        // Jobs — created, plus a completed event when completedAt is set
        const jobRows = await this.db
            .select({
                jobId: jobs.jobId,
                title: jobs.title,
                status: jobs.status,
                completedAt: jobs.completedAt,
                createdAt: jobs.createdAt,
            })
            .from(jobs)
            .where(and(eq(jobs.orgId, orgId), eq(jobs.clientId, clientId)))
            .orderBy(desc(jobs.createdAt))
            .limit(SOURCE_LIMIT);
        for (const r of jobRows as any[]) {
            const label = r.title || 'Job';
            events.push({
                id: `job_${r.jobId}`,
                type: 'job_created',
                title: `Job created — ${label}`,
                amount: null,
                at: iso(r.createdAt),
                refId: r.jobId,
            });
            if (r.completedAt) {
                events.push({
                    id: `jobdone_${r.jobId}`,
                    type: 'job_completed',
                    title: `Job completed — ${label}`,
                    amount: null,
                    at: iso(r.completedAt),
                    refId: r.jobId,
                });
            }
        }

        // Client added
        events.push({
            id: `client_${clientId}`,
            type: 'client_created',
            title: `${clientName} added as a client`,
            amount: null,
            at: iso(clientCreatedAt),
            refId: clientId,
        });

        return events
            .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
            .slice(0, TIMELINE_LIMIT);
    }
}
