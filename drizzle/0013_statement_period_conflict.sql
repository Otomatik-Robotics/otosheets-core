-- Statement period disambiguation. Record the provenance of the resolved period
-- (period_source: 'printed' | 'derived' | 'user') and, when the statement's
-- printed period and the derived row-date range disagree, persist the two
-- candidate ranges (period_conflict jsonb: {rowStart,rowEnd,statementStart,statementEnd})
-- so the frontend can prompt the user to choose. Additive + idempotent per expand-contract.
ALTER TABLE statements ADD COLUMN IF NOT EXISTS period_source TEXT;--> statement-breakpoint
ALTER TABLE statements ADD COLUMN IF NOT EXISTS period_conflict JSONB;
