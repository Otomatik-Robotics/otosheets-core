-- Reverse-direction feed dedupe: a bank-feed row that duplicates an
-- already-ingested statement row of the same (unified) account is marked and
-- excluded from summaries — the mirror of statement_transactions.duplicate_of_txn_id.
-- Additive + idempotent per expand-contract.
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS duplicate_of_txn_id TEXT;
