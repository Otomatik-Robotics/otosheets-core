import { pgTable, text, integer, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';

/**
 * Shared (cross-tenant) merchant → category cache for statement categorisation.
 *
 * A GLOBAL, reference-data prior — NOT org-scoped — built from confident
 * categorisations across all tenants. Its purpose is throughput: once a common
 * merchant is agreed on, its rows resolve deterministically instead of hitting
 * the model, so only genuinely novel merchants reach Bedrock. It generalises
 * the PER-USER learned vendor rules (backend `shared/vendorRules.ts`) into a
 * curated shared tier that sits BELOW a user's own rule in precedence (a user's
 * business truth always wins; the shared cache is only a prior).
 *
 * Privacy/tenancy: the ONLY data stored is the normalised merchant string, a
 * category label, an aggregate GST treatment, and DISTINCT-ORG counts. Never
 * amounts, descriptions beyond the normalised key, or user identifiers.
 *
 * Two tables:
 *  - `merchant_category_votes` — the evidence: one row per (merchant, category,
 *    org). The PK includes org_id so DISTINCT-org agreement is `COUNT(*)` per
 *    (merchant, category). This is the source of truth; the aggregate is always
 *    recomputable from it, which makes promotion idempotent under at-least-once
 *    replay (a repeat vote from an org that already voted never changes the
 *    distinct-org count).
 *  - `merchant_categories` — the derived answer: the plurality category across
 *    distinct orgs, its modal GST treatment, and the winning distinct-org count.
 *    Lookups read ONLY this table and only rows that cleared the promotion gate.
 */

/** Per (merchant, category, org) agreement evidence. Distinct-org = row count per (merchant, category). */
export const merchantCategoryVotes = pgTable('merchant_category_votes', {
    merchantKey: text('merchant_key').notNull(),   // normaliseMerchant(description) output
    category: text('category').notNull(),          // statement category label
    orgId: text('org_id').notNull(),               // the voting tenant (distinct-org unit)
    gstTreatment: text('gst_treatment'),           // this org's latest GST treatment for the pair
    hits: integer('hits').notNull().default(1),    // soft counter — sightings from this org
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    primaryKey({ columns: [t.merchantKey, t.category, t.orgId] }),
    index('merchant_cat_votes_key').on(t.merchantKey),
]);

/** The derived, promoted answer for a merchant (plurality across distinct orgs). */
export const merchantCategories = pgTable('merchant_categories', {
    merchantKey: text('merchant_key').primaryKey(),   // normaliseMerchant(description) output
    category: text('category').notNull(),             // plurality winner across distinct orgs
    gstTreatment: text('gst_treatment'),              // modal GST treatment for the winning category
    agreeOrgCount: integer('agree_org_count').notNull().default(0), // distinct orgs behind the winner
    totalHits: integer('total_hits').notNull().default(0),          // Σ hits across the winning category's votes
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    // Lookups filter on the promotion gate (agree_org_count >= N).
    index('merchant_categories_agree').on(t.agreeOrgCount),
]);
