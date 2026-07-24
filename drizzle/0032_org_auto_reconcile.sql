-- Auto-reconciliation opt-in (per org). Autonomous bank ↔ ledger matching:
-- when enabled, statement ingest stages auto-eligible matches for a single
-- human batch-confirm. Absent/NULL means disabled (opt-in, default OFF).
-- Shape: { "enabled": boolean }
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS auto_reconcile jsonb;
