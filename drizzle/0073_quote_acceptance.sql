ALTER TABLE invoices ADD COLUMN IF NOT EXISTS quote_acceptance_token_hashes jsonb;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS converted_invoice_id text;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source_quote_id text;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS quote_accepted_at text;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS quote_accepted_event_id text;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS quote_acceptance_published_at text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invoices_quote_acceptance_pending_idx ON invoices (quote_accepted_at, invoice_id)
WHERE quote_accepted_at IS NOT NULL AND quote_acceptance_published_at IS NULL;
