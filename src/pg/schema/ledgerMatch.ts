import { pgTable, text, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';

/**
 * Bank ↔ ledger matching support tables (statement reconciliation step 6).
 *
 * The links themselves live as columns on statement_transactions /
 * bank_transactions (matched_invoice_id, matched_receipt_id, match_source) —
 * this table is the REJECTION memory: a (txn, target) pair the user
 * dismissed. The matching engine never re-proposes a rejected pair, and the
 * key is the transaction's deterministic id so the memory survives statement
 * reprocessing and feed re-syncs.
 */
export const matchRejections = pgTable('match_rejections', {
    txnId: text('txn_id').notNull(),          // statement or feed txn id — both are deterministic
    targetType: text('target_type').notNull(), // INVOICE | RECEIPT
    targetId: text('target_id').notNull(),     // invoiceId | receiptId
    userId: text('user_id').notNull(),
    rejectedBy: text('rejected_by'),
    rejectedAt: timestamp('rejected_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    primaryKey({ columns: [t.txnId, t.targetType, t.targetId] }),
    index('match_rejections_user').on(t.userId),
]);
