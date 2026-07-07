import { z } from 'zod';
import { ClientStoredSchema } from '../client/schema';

/**
 * Client Overview — the per-client CRM "cockpit" reporting DTO.
 *
 * This is a READ-ONLY reporting projection (POSTGRES_MIGRATION_PLAN.md §8): it is
 * computed with real SQL aggregation over the billing-core tables, not read from a
 * maintained counter and never snapshotted. There is deliberately no DynamoDB
 * counterpart — the aggregation exists only in the pg reporting layer.
 */

export const ClientOverviewKpisSchema = z.object({
    /** Money actually collected from this client to date — sum(paidAmount). */
    lifetimeValue: z.number(),
    /** Owed but unpaid — sum(total - paid) over SENT/PARTIAL/OVERDUE invoices. */
    outstanding: z.number(),
    /** Portion of `outstanding` whose dueDate is in the past. */
    overdue: z.number(),
    /** Count of real invoices (excludes payment links and quotes). */
    invoiceCount: z.number(),
    /** Count of fully-paid invoices. */
    paidInvoiceCount: z.number(),
    /** Mean days from issue to final payment across paid invoices; null if none. */
    avgPayDays: z.number().nullable(),
});
export type ClientOverviewKpis = z.infer<typeof ClientOverviewKpisSchema>;

export const ClientOverviewInvoiceSchema = z.object({
    invoiceId: z.string(),
    invoiceNumber: z.string(),
    status: z.string().nullable(),
    totalAmount: z.number(),
    paidAmount: z.number(),
    date: z.string().nullable(),
    dueDate: z.string().nullable(),
    createdAt: z.string(),
});
export type ClientOverviewInvoice = z.infer<typeof ClientOverviewInvoiceSchema>;

export const ClientTimelineEventTypeSchema = z.enum([
    'invoice_created',
    'payment_received',
    'job_created',
    'job_completed',
    'client_created',
]);
export type ClientTimelineEventType = z.infer<typeof ClientTimelineEventTypeSchema>;

export const ClientTimelineEventSchema = z.object({
    id: z.string(),
    type: ClientTimelineEventTypeSchema,
    title: z.string(),
    /** Dollar amount when the event carries one (invoice/payment), else null. */
    amount: z.number().nullable(),
    /** ISO-8601 instant used for ordering. */
    at: z.string(),
    /** The source entity id (invoiceId / paymentId / jobId), for deep-linking. */
    refId: z.string().nullable(),
});
export type ClientTimelineEvent = z.infer<typeof ClientTimelineEventSchema>;

/**
 * Compact per-client rollup for list rows (the Ledger's status + outstanding columns).
 * A single GROUP BY over the page's client ids — never one query per row.
 */
export const ClientRollupSchema = z.object({
    clientId: z.string(),
    outstanding: z.number(),
    overdue: z.number(),
    invoiceCount: z.number(),
    paidInvoiceCount: z.number(),
    lifetimeValue: z.number(),
});
export type ClientRollup = z.infer<typeof ClientRollupSchema>;

export const ClientOverviewSchema = z.object({
    client: ClientStoredSchema,
    kpis: ClientOverviewKpisSchema,
    recentInvoices: z.array(ClientOverviewInvoiceSchema),
    timeline: z.array(ClientTimelineEventSchema),
});
export type ClientOverview = z.infer<typeof ClientOverviewSchema>;
