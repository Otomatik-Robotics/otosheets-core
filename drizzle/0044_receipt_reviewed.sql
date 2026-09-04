-- An AI risk flag is written once at ingest and nothing has ever been able to
-- clear it, so a flagged receipt stayed on the Home card for the life of the
-- record and the only way off it was to delete the receipt.
--
-- reviewed_at is the acknowledgement: set when the owner marks a flagged
-- receipt as looked at, or apportions it, and read as "no longer counted".
-- The risk level itself is left alone — it is history, not a toggle.
--
-- Additive and nullable (expand-contract): every existing receipt reads back
-- as unreviewed, which is the correct starting state.
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
--> statement-breakpoint
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS reviewed_by text;
--> statement-breakpoint
-- The summary filters on this on every read, so the partial index carries it.
CREATE INDEX IF NOT EXISTS receipts_org_unreviewed_idx ON receipts (org_id) WHERE reviewed_at IS NULL;
