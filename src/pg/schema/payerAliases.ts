import { pgTable, text, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';

/**
 * Payer → client aliases (0034) — an ORG-SCOPED map from a normalised bank
 * descriptor ("payer key", the `normaliseMerchant()` output) to a CRM client.
 *
 * When an income credit's payer key resolves to a client here, the pipeline
 * attributes the credit to that client confidently — and, for a GST-registered
 * business, treats it as GST-inclusive income. Learned as the user creates or
 * links clients for the payers a statement surfaces, so future reconciliations
 * recognise them automatically.
 *
 * Unlike the cross-tenant merchant→category cache this mirrors in shape, a
 * client belongs to exactly one org, so this is keyed (org_id, payer_key).
 */
export const payerAliases = pgTable('payer_aliases', {
    orgId: text('org_id').notNull(),          // FK → orgs (cascade); enforced in SQL
    payerKey: text('payer_key').notNull(),    // normaliseMerchant(description) output
    clientId: text('client_id').notNull(),    // FK → clients (cascade); enforced in SQL
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    primaryKey({ columns: [t.orgId, t.payerKey] }),
    index('payer_aliases_client_idx').on(t.clientId),
]);
