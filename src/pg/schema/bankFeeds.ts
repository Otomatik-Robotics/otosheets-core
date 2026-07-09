import {
    pgTable, text, bigint, numeric, jsonb, timestamp, date, index,
} from 'drizzle-orm/pg-core';

/**
 * Bank-feed domain (open banking via Fiskil / CDR) — born in Postgres, no
 * Dynamo counterpart, no cutover flag. Live-feed sibling of the statements
 * domain: the extraction layer is written by sync upserts keyed on the
 * provider's own ids (so re-syncs are idempotent), and the annotation layer
 * (category / GST / review) mirrors statement_transactions so reporting can
 * UNION the two sources.
 *
 * Money is INTEGER CENTS (BIGINT), matching the statements domain.
 * Connection/consent state (Fiskil end-user id, consent ids, tokens) lives in
 * the integrations table (Dynamo) alongside the other provider connections —
 * only the relational data (accounts, transactions) lives here.
 */

export const bankAccounts = pgTable('bank_accounts', {
    accountId: text('account_id').primaryKey(),               // provider account id — deterministic
    userId: text('user_id').notNull(),
    organizationId: text('organization_id'),
    // Profile scope — NULLABLE (see statements.ts): backfilled from
    // orgs.business_profile_id where organizationId is present.
    businessProfileId: text('business_profile_id'),
    provider: text('provider').notNull().default('fiskil'),
    consentId: text('consent_id'),
    institutionId: text('institution_id'),
    institutionName: text('institution_name'),
    name: text('name'),
    productName: text('product_name'),
    productCategory: text('product_category'),
    accountNumberMasked: text('account_number_masked'),       // last 4 only — never the full number
    bsb: text('bsb'),
    openStatus: text('open_status'),
    status: text('status').notNull().default('ACTIVE'),       // ACTIVE | DISCONNECTED
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    index('bank_accounts_user').on(t.userId),
    index('bank_accounts_org').on(t.organizationId),
    index('bank_accounts_profile').on(t.businessProfileId),
]);

export const bankTransactions = pgTable('bank_transactions', {
    txnId: text('txn_id').primaryKey(),                       // provider transaction id — deterministic
    accountId: text('account_id').notNull()
        .references(() => bankAccounts.accountId, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    organizationId: text('organization_id'),
    fy: text('fy').notNull(),                                 // '2025-26' (AU financial year of txn_date)
    // mode 'string' keeps calendar dates as plain 'YYYY-MM-DD' — never round-tripped
    // through a JS Date, which would shift them across the local timezone.
    txnDate: date('txn_date', { mode: 'string' }),
    description: text('description'),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(), // signed: credit +, debit −
    direction: text('direction'),                             // DEBIT | CREDIT
    status: text('status'),                                   // POSTED | PENDING
    merchantName: text('merchant_name'),
    providerCategory: text('provider_category'),              // CDR category string from the provider
    raw: jsonb('raw'),                                        // provider payload for later enrichment
    // categorisation (mutable annotation layer — mirrors statement_transactions;
    // sync upserts must never touch these columns)
    category: text('category'),
    categorySource: text('category_source'),                  // RULE | AI | USER | ADVISOR
    categoryConfidence: numeric('category_confidence', { precision: 3, scale: 2 }),
    gstTreatment: text('gst_treatment'),                      // GST | GST_FREE | INPUT_TAXED | NOT_REPORTABLE
    gstAmountCents: bigint('gst_amount_cents', { mode: 'number' }),
    reviewReason: text('review_reason'),
    reviewStatus: text('review_status').notNull().default('PENDING'),
    confirmedBy: text('confirmed_by'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    index('bank_txn_user_fy_date').on(t.userId, t.fy, t.txnDate),
    index('bank_txn_account_date').on(t.accountId, t.txnDate),
    index('bank_txn_user_review').on(t.userId, t.reviewReason),
]);
