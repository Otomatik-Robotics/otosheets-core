import { pgTable, text, bigint, jsonb, primaryKey, index } from 'drizzle-orm/pg-core';
import { orgs } from './identity';

/**
 * Commerce (shop orders) — the storefront shop's orders, migrated from DynamoDB
 * `expense-app-orders-{env}` (PK orgId, SK orderId = `ord-{stripeSessionId}`).
 * Orders are reported on (analytics revenue, per-day totals, future per-referrer
 * attribution joins), which per the source-of-truth rule puts them in Postgres;
 * DynamoDB stays dual-written as the rollback mirror. Timestamps are ISO TEXT,
 * mirroring the DTO exactly (like voice_credit_ledger).
 */
export const shopOrders = pgTable('shop_orders', {
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),
    orderId: text('order_id').notNull(),           // ord-{stripeSessionId} — deterministic, webhook-replay safe
    orderNumber: bigint('order_number', { mode: 'number' }).notNull(),
    businessProfileId: text('business_profile_id'),
    status: text('status').notNull(),              // pending|paid|fulfilled|shipped|cancelled|refunded
    buyer: jsonb('buyer').notNull(),               // { name, email, phone? }
    shippingAddress: jsonb('shipping_address'),
    shippingOption: jsonb('shipping_option'),
    lines: jsonb('lines').notNull(),
    subtotalCents: bigint('subtotal_cents', { mode: 'number' }).notNull().default(0),
    shippingCents: bigint('shipping_cents', { mode: 'number' }).notNull().default(0),
    taxCents: bigint('tax_cents', { mode: 'number' }).notNull().default(0),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull().default('AUD'),
    stripeSessionId: text('stripe_session_id').notNull(),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    linkedInvoiceId: text('linked_invoice_id'),
    fulfilment: jsonb('fulfilment'),
    refund: jsonb('refund'),
    receiptSentAt: text('receipt_sent_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
}, (t) => [
    primaryKey({ columns: [t.orgId, t.orderId] }),
    index('shop_orders_org_created_idx').on(t.orgId, t.createdAt),
    index('shop_orders_org_status_idx').on(t.orgId, t.status),
]);

/** Per-org sequential order-number counter — mirrors the Dynamo COUNTER item. */
export const shopOrderCounters = pgTable('shop_order_counters', {
    orgId: text('org_id').primaryKey().references(() => orgs.orgId, { onDelete: 'cascade' }),
    seq: bigint('seq', { mode: 'number' }).notNull().default(0),
});
