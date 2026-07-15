-- Bank ↔ ledger matching (statement reconciliation step 6): user-accepted
-- links from bank money rows to the business ledger (invoices / receipts),
-- plus a rejection memory so a dismissed suggestion is never re-proposed —
-- keyed by txn_id so it survives statement reprocessing (deterministic ids).
-- Additive + idempotent per expand-contract.
ALTER TABLE statement_transactions ADD COLUMN IF NOT EXISTS matched_invoice_id TEXT;
--> statement-breakpoint
ALTER TABLE statement_transactions ADD COLUMN IF NOT EXISTS matched_receipt_id TEXT;
--> statement-breakpoint
ALTER TABLE statement_transactions ADD COLUMN IF NOT EXISTS match_source TEXT;
--> statement-breakpoint
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS matched_invoice_id TEXT;
--> statement-breakpoint
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS matched_receipt_id TEXT;
--> statement-breakpoint
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS match_source TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stmt_txn_matched_invoice ON statement_transactions (matched_invoice_id) WHERE matched_invoice_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stmt_txn_matched_receipt ON statement_transactions (matched_receipt_id) WHERE matched_receipt_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bank_txn_matched_invoice ON bank_transactions (matched_invoice_id) WHERE matched_invoice_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bank_txn_matched_receipt ON bank_transactions (matched_receipt_id) WHERE matched_receipt_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS match_rejections (
    txn_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    rejected_by TEXT,
    rejected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (txn_id, target_type, target_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS match_rejections_user ON match_rejections (user_id);
