import {
    pgTable, text, integer, bigint, boolean, numeric, jsonb, timestamp, date,
    index, uniqueIndex, unique,
} from 'drizzle-orm/pg-core';

/**
 * Statements domain — born in Postgres (no Dynamo counterpart, no cutover
 * flag). See docs/architecture/STATEMENT_CATEGORISATION.md in the app repo.
 *
 * Money is INTEGER CENTS (BIGINT) throughout this domain — a deliberate
 * deviation from the migration plan's NUMERIC(12,2) dollars convention: the
 * verification engine (running-balance chain) must be float-free exact
 * arithmetic, and this domain is born new so there are no legacy DTOs to
 * match.
 *
 * `userId` may be a real Cognito sub or `prospect#{prospectId}` for guest
 * uploads that predate signup; claiming re-points the rows in one UPDATE.
 */

export const statements = pgTable('statements', {
    statementId: text('statement_id').primaryKey(),          // ULID
    userId: text('user_id').notNull(),
    organizationId: text('organization_id'),
    // Profile scope — NULLABLE (unlike the org-scoped operational tables): guest
    // uploads (`userId = prospect#…`) have no org and therefore no profile.
    // Backfilled from orgs.business_profile_id where organizationId is present.
    businessProfileId: text('business_profile_id'),
    fy: text('fy').notNull(),                                 // '2025-26' (AU financial year)
    fileName: text('file_name'),
    fileType: text('file_type'),
    s3Key: text('s3_key').notNull(),
    status: text('status').notNull().default('UPLOADED'),
    contentHash: text('content_hash'),
    extractionVersion: integer('extraction_version').notNull().default(0),
    textractJobId: text('textract_job_id'),
    bankName: text('bank_name'),
    accountLast4: text('account_last4'),
    // Soft link to bank_accounts — the stable account identity behind the
    // denormalised bankName/accountLast4 strings. Statement-derived accounts
    // are provider 'statement' rows; a matching open-banking (fiskil) account
    // is reused so both ingestion sources share one identity. Null when the
    // account couldn't be detected (or for guest/prospect uploads).
    accountId: text('account_id'),
    // mode 'string' keeps calendar dates as plain 'YYYY-MM-DD' — never round-tripped
    // through a JS Date, which would shift them across the local timezone.
    periodStart: date('period_start', { mode: 'string' }),
    periodEnd: date('period_end', { mode: 'string' }),
    // Provenance of periodStart/End: 'printed' (statement header), 'derived'
    // (row-date range), or 'user' (manual disambiguation). Null pre-resolution.
    periodSource: text('period_source'),
    // When the printed period and the derived row-date range disagree, the two
    // candidate ranges the user picks between: {rowStart,rowEnd,statementStart,statementEnd}.
    // Null once resolved (or when they never conflicted).
    periodConflict: jsonb('period_conflict'),
    verification: jsonb('verification'),
    txnCount: integer('txn_count'),
    needsReviewCount: integer('needs_review_count'),
    confirmedCount: integer('confirmed_count'),
    // Worker pick-up count (SQS ApproximateReceiveCount); >1 = a retry in flight.
    processingAttempt: integer('processing_attempt'),
    errorMessage: text('error_message'),
    duplicateOfStatementId: text('duplicate_of_statement_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    index('statements_user_fy').on(t.userId, t.fy),
    index('statements_org').on(t.organizationId, t.fy),
    index('statements_profile').on(t.businessProfileId, t.fy),
    index('statements_account').on(t.accountId),
    uniqueIndex('statements_dedupe').on(t.userId, t.contentHash),
]);

export const statementTransactions = pgTable('statement_transactions', {
    txnId: text('txn_id').primaryKey(),                       // '{statementId}#{seq5}' — deterministic
    statementId: text('statement_id').notNull()
        .references(() => statements.statementId, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    fy: text('fy').notNull(),
    seq: integer('seq').notNull(),
    // provenance — links each row to the exact source location on the PDF
    page: integer('page'),
    rowIndex: integer('row_index'),
    bbox: jsonb('bbox'),                                      // normalised 0–1 {x,y,w,h}; null for CSV sources
    rawText: text('raw_text'),
    // parsed facts (immutable extraction layer; integer cents)
    txnDate: date('txn_date', { mode: 'string' }), // 'YYYY-MM-DD', timezone-free
    description: text('description'),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(), // signed: credit +, debit −
    direction: text('direction'),                             // DEBIT | CREDIT
    balanceCents: bigint('balance_cents', { mode: 'number' }),
    // verification
    chainOk: boolean('chain_ok'),
    verificationFlags: jsonb('verification_flags'),           // string[] e.g. ['CHAIN_BREAK','UNPARSEABLE_AMOUNT']
    // deterministic money-flow class (pattern/sign derived, LLM-independent)
    flowClass: text('flow_class'),                            // INCOME | EXPENSE | TRANSFER | REFUND
    // Cross-statement reconciliation layer (both null for ordinary rows):
    // duplicateOfTxnId — this row was already ingested for the same account by an
    // overlapping statement; duplicates are excluded from every summary/tally.
    duplicateOfTxnId: text('duplicate_of_txn_id'),
    // transferPairId — persisted internal-transfer pairing: the debit leg on one
    // account and the credit leg on another share one id (the debit's txnId).
    transferPairId: text('transfer_pair_id'),
    // Bank ↔ ledger matching layer — a user-accepted link from this bank-money
    // row to the business ledger. Only ever written on explicit user accept
    // (matchSource USER; AUTO reserved). Reprocess upserts never touch these.
    matchedInvoiceId: text('matched_invoice_id'),
    matchedReceiptId: text('matched_receipt_id'),
    matchSource: text('match_source'),                        // AUTO | USER
    // categorisation (mutable annotation layer)
    category: text('category'),
    categorySource: text('category_source'),                  // RULE | AI | USER | ADVISOR
    categoryConfidence: numeric('category_confidence', { precision: 3, scale: 2 }),
    gstTreatment: text('gst_treatment'),                      // GST | GST_FREE | INPUT_TAXED | NOT_REPORTABLE
    gstAmountCents: bigint('gst_amount_cents', { mode: 'number' }),
    reviewReason: text('review_reason'),                      // null = no review needed (partial-index queue)
    reviewStatus: text('review_status').notNull().default('PENDING'),
    confirmedBy: text('confirmed_by'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    unique('stmt_txn_statement_seq').on(t.statementId, t.seq),
    index('stmt_txn_user_fy_date').on(t.userId, t.fy, t.txnDate),
    index('stmt_txn_review').on(t.userId, t.reviewReason),
]);
