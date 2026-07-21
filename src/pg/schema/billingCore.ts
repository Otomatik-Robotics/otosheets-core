import { sql } from 'drizzle-orm';
import {
    pgTable, text, boolean, integer, numeric, jsonb, timestamp,
    index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { orgs } from './identity';

// Date-ish DTO fields (date, dueDate, paidDate, convertedAt, linkExpiresAt) are
// stored as TEXT, not pg DATE/TIMESTAMP: DynamoDB holds the exact string and a
// typed column would normalize the format ("2026-07-01" vs full ISO) → shadow
// diffs. ISO-8601 text still range-queries lexically (how Dynamo does it too).
// Only createdAt/updatedAt use timestamptz — they are reliably full ISO
// (repo-set via new Date().toISOString()) and benefit from real ordering.

/**
 * Phase 2 (billing-core) tables — docs/POSTGRES_MIGRATION_PLAN.md §3/§4.
 *
 * Lessons applied from the identity phase (see project memory / §12):
 *  - NO `NOT NULL DEFAULT` on fields DynamoDB stores sparsely — it materializes
 *    values Dynamo lacks and produces perpetual shadow-read diffs. Optional /
 *    defaulted scalars are nullable here; fromRow drops nulls so pg mirrors
 *    Dynamo's absence exactly. Only genuinely-always-present columns are NOT NULL.
 *  - Money stays `number` in the DTO → NUMERIC(12,2) here, nullable (an old
 *    invoice may lack paidAmount); reporting COALESCEs.
 *  - Ownership is an explicit `owner_id` column (from the Dynamo sk prefix
 *    `userId#invoiceId`), not hidden in a sort key.
 *  - `clientSnapshot` is preserved only as `legacy_client_snapshot` for lossless
 *    migration; the live path joins on client_id (No Data Snapshots rule).
 */

export const clients = pgTable('clients', {
    clientId: text('client_id').primaryKey(),
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),
    businessProfileId: text('business_profile_id'),   // profile scope; NOT NULL after backfill (0015)
    createdBy: text('created_by').notNull(),
    isCompany: boolean('is_company'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    abn: text('abn'),
    address: text('address'),
    convertedFromLeadId: text('converted_from_lead_id'),   // soft ref (leads arrive phase 3)
    convertedAt: text('converted_at'),
    paymentLinkUsageCount: integer('payment_link_usage_count'),
    archived: boolean('archived'),                         // soft-delete: hidden from active lists
    archivedAt: text('archived_at'),
    // Deprecated single-contact fields (superseded by the contacts child table)
    // — preserved for lossless migration, mapped to/from DTO `contact`/`contactPerson`.
    legacyContact: jsonb('legacy_contact'),
    legacyContactPerson: text('legacy_contact_person'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    index('clients_org_created_idx').on(t.orgId, t.createdAt.desc()),
    index('clients_profile_created_idx').on(t.businessProfileId, t.createdAt.desc()),
    index('clients_name_trgm').using('gin', sql`${t.name} gin_trgm_ops`),
    index('clients_org_email_idx').on(t.orgId, t.email),   // plain, not unique (see identity email lesson)
    index('clients_org_usage_idx').on(t.orgId, t.paymentLinkUsageCount.desc()),  // replaces UsageCountIndex
]);

// contacts[] → child table (searchable; company primary-contact logic stays in core helpers)
export const clientContacts = pgTable('client_contacts', {
    contactId: text('contact_id').primaryKey(),
    clientId: text('client_id').notNull().references(() => clients.clientId, { onDelete: 'cascade' }),
    firstName: text('first_name'),
    lastName: text('last_name'),
    email: text('email'),
    phone: text('phone'),
    isPrimary: boolean('is_primary'),
    sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [
    index('client_contacts_client_idx').on(t.clientId),
]);

export const invoices = pgTable('invoices', {
    invoiceId: text('invoice_id').primaryKey(),
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),
    businessProfileId: text('business_profile_id'),   // profile scope; NOT NULL after backfill (0015)
    ownerId: text('owner_id').notNull(),       // Dynamo sk prefix — ownership source of truth
    createdBy: text('created_by').notNull(),
    invoiceNumber: text('invoice_number').notNull(),
    clientId: text('client_id').references(() => clients.clientId, { onDelete: 'set null' }),
    date: text('issue_date'),                  // DTO `date` — exact string, see note above
    dueDate: text('due_date'),
    status: text('status'),
    subtotal: numeric('subtotal', { precision: 12, scale: 2 }),
    gstMode: text('gst_mode'),
    gstAmount: numeric('gst_amount', { precision: 12, scale: 2 }),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }),
    taxRate: numeric('tax_rate', { precision: 6, scale: 3 }),
    taxLabel: text('tax_label'),
    paidAmount: numeric('paid_amount', { precision: 12, scale: 2 }),
    notes: text('notes'),
    isRecurring: boolean('is_recurring'),
    recurringConfig: jsonb('recurring_config'),
    isQuote: boolean('is_quote'),
    isPaymentLink: boolean('is_payment_link'),
    paymentUrl: text('payment_url'),
    stripeSessionId: text('stripe_session_id'),
    linkExpiresAt: text('link_expires_at'),
    fromTimeEntries: jsonb('from_time_entries'),
    followUpSequenceId: text('follow_up_sequence_id'),
    voidReason: text('void_reason'),                         // surfaced by drift report
    revisedFrom: text('revised_from'),                       // ref to a prior invoice version
    legacyLineItems: jsonb('legacy_line_items'),             // deprecated `lineItems` alias of items
    legacyClientSnapshot: jsonb('legacy_client_snapshot'),   // backfill-only; drop at contract step
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    index('invoices_org_created_idx').on(t.orgId, t.createdAt.desc()),        // list default
    index('invoices_profile_created_idx').on(t.businessProfileId, t.createdAt.desc()),
    index('invoices_profile_status_due_idx').on(t.businessProfileId, t.status, t.dueDate),
    index('invoices_org_status_due_idx').on(t.orgId, t.status, t.dueDate),    // overdue queries
    index('invoices_client_idx').on(t.clientId),
    index('invoices_number_trgm').using('gin', sql`${t.invoiceNumber} gin_trgm_ops`),
    index('invoices_stripe_session_idx').on(t.stripeSessionId),
    // (org_id, invoice_number) UNIQUE deferred to a later migration — audit clean
    // (auditInvoiceNumbers: 0 dupes in dev) but promote only after prod audit.
]);

// items[] → child table (enables line-item reporting / price-book analysis)
export const invoiceLineItems = pgTable('invoice_line_items', {
    lineItemId: text('line_item_id').primaryKey(),
    invoiceId: text('invoice_id').notNull().references(() => invoices.invoiceId, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 3 }),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }),
    total: numeric('total', { precision: 12, scale: 2 }),
    cost: numeric('cost', { precision: 12, scale: 2 }),                 // 0030 margin reporting
    priceBookItemId: text('price_book_item_id'),                        // 0030
    sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [
    index('invoice_line_items_invoice_idx').on(t.invoiceId),
]);

export const invoicePayments = pgTable('invoice_payments', {
    paymentId: text('payment_id').primaryKey(),
    invoiceId: text('invoice_id').notNull().references(() => invoices.invoiceId, { onDelete: 'cascade' }),
    orgId: text('org_id').notNull().references(() => orgs.orgId),
    businessProfileId: text('business_profile_id'),   // profile scope; NOT NULL after backfill (0015)
    userId: text('user_id'),                   // nullable: Dynamo stores it sparsely
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    method: text('method').notNull(),
    date: text('paid_date'),                   // DTO `date` — exact string
    note: text('note'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    index('invoice_payments_invoice_idx').on(t.invoiceId),
    index('invoice_payments_org_date_idx').on(t.orgId, t.date.desc()),
    index('invoice_payments_profile_date_idx').on(t.businessProfileId, t.date.desc()),
    // webhook idempotency: a Stripe payment intent can only be recorded once
    uniqueIndex('invoice_payments_stripe_pi_uq').on(t.stripePaymentIntentId)
        .where(sql`stripe_payment_intent_id IS NOT NULL`),
]);
