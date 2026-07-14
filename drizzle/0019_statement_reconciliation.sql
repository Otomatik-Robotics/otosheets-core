-- Statement reconciliation foundations (multi-account correctness):
--   statements.account_id          — soft link to bank_accounts; statement-derived
--                                    accounts are rows with provider 'statement',
--                                    feed (fiskil) accounts are reused when the
--                                    institution + last-4 match, so both sources
--                                    share one account identity.
--   statement_transactions.duplicate_of_txn_id — set when the same account already
--                                    holds this row from an overlapping statement;
--                                    duplicate rows are excluded from every summary.
--   statement_transactions.transfer_pair_id    — persisted internal-transfer pairing
--                                    (debit leg on one account, credit leg on another).
-- Additive + idempotent per expand-contract.
ALTER TABLE statements ADD COLUMN IF NOT EXISTS account_id TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS statements_account ON statements(account_id);
--> statement-breakpoint
ALTER TABLE statement_transactions ADD COLUMN IF NOT EXISTS duplicate_of_txn_id TEXT;
--> statement-breakpoint
ALTER TABLE statement_transactions ADD COLUMN IF NOT EXISTS transfer_pair_id TEXT;
