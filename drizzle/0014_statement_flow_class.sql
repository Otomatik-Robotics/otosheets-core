-- Deterministic money-flow class on statement transactions. Derived by the
-- pipeline from sign + conservative description patterns (never the LLM):
-- 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'REFUND'. Drives the trustworthy
-- top-line totals (income / expenditure / transfers) independently of the
-- LLM-assigned category. Null on rows extracted before this column existed —
-- a reprocess backfills. Additive + idempotent per expand-contract.
ALTER TABLE statement_transactions ADD COLUMN IF NOT EXISTS flow_class TEXT;
