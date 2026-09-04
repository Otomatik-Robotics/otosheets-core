import { sql } from 'drizzle-orm';
import {
    pgTable, text, boolean, numeric, smallint, jsonb, timestamp,
    index, uniqueIndex, primaryKey,
} from 'drizzle-orm/pg-core';
import { orgs } from './identity';

/**
 * Bookkeeping module (0046) — the asset register and BAS periods.
 *
 * Both are Postgres-only (no DynamoDB mirror, no cutover flag): an asset
 * exists to be folded into a depreciation schedule and a BAS period to hold a
 * quarter's aggregated figures — reporting-layer entities per the
 * source-of-truth rule (forms / ad_campaigns precedent).
 *
 * Money is NUMERIC(12,2) dollars and dates are YYYY-MM-DD TEXT, matching the
 * ops/billing tables they join. Timestamps are timestamptz (mode 'date');
 * repos convert to ISO strings at the boundary.
 */

export const assets = pgTable('assets', {
    assetId: text('asset_id').primaryKey(),
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),
    businessProfileId: text('business_profile_id'),
    ownerId: text('owner_id').notNull(),
    createdBy: text('created_by'),
    name: text('name').notNull(),
    category: text('category').notNull(),          // VEHICLE|COMPUTER|OFFICE|TOOLS|PLANT|FURNITURE|OTHER
    isCar: boolean('is_car').notNull().default(false),
    priceIncGst: numeric('price_inc_gst', { precision: 12, scale: 2 }).notNull(),
    gstOnPrice: numeric('gst_on_price', { precision: 12, scale: 2 }).notNull().default('0'),
    businessUsePercent: numeric('business_use_percent', { precision: 5, scale: 2 }).notNull().default('100'),
    purchaseDate: text('purchase_date').notNull(),  // YYYY-MM-DD
    firstUsedDate: text('first_used_date'),         // YYYY-MM-DD; null = depreciation cannot start yet
    receiptId: text('receipt_id'),                  // the receipt it was promoted from (unique per org)
    ledgerAccountCode: text('ledger_account_code'),
    notes: text('notes'),
    status: text('status').notNull().default('ACTIVE'),   // ACTIVE|DISPOSED
    disposal: jsonb('disposal'),                    // { date, proceedsIncGst, gstOnSale, kind }
    costAdditions: jsonb('cost_additions').notNull().default(sql`'[]'::jsonb`),
    businessUseReviews: jsonb('business_use_reviews').notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    index('assets_org_created_idx').on(t.orgId, t.createdAt.desc(), t.assetId),
    index('assets_org_status_idx').on(t.orgId, t.status),
    uniqueIndex('assets_org_receipt_uq').on(t.orgId, t.receiptId).where(sql`receipt_id IS NOT NULL`),
    index('assets_org_no_first_use_idx').on(t.orgId).where(sql`first_used_date IS NULL AND status = 'ACTIVE'`),
]);

export const basPeriods = pgTable('bas_periods', {
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),
    period: text('period').notNull(),               // 'FY26/27-Q1'
    fy: text('fy').notNull(),                       // 'FY26/27'
    quarter: smallint('quarter').notNull(),         // 1..4 (Q1 = Jul–Sep)
    periodStart: text('period_start').notNull(),    // YYYY-MM-DD
    periodEnd: text('period_end').notNull(),
    dueDate: text('due_date').notNull(),
    lodgedAt: timestamp('lodged_at', { withTimezone: true, mode: 'date' }),
    lodgedBy: text('lodged_by'),
    figures: jsonb('figures'),                      // snapshot of the figures at lodgement
    confidence: smallint('confidence'),             // 50|75|90|100 at lodgement
    reasons: jsonb('reasons'),                      // BasReason[] at lodgement
    reminderBeforeAt: timestamp('reminder_before_at', { withTimezone: true, mode: 'date' }),
    reminderDueAt: timestamp('reminder_due_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    primaryKey({ columns: [t.orgId, t.period] }),
]);
