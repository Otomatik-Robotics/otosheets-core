-- Legacy/uncommon billing fields surfaced by the dev drift report (2026-07-04).
-- Additive, nullable — preserve DynamoDB's exact data for lossless migration.
-- clients: deprecated single-contact fields (superseded by the contacts child table).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS legacy_contact JSONB;
--> statement-breakpoint
ALTER TABLE clients ADD COLUMN IF NOT EXISTS legacy_contact_person TEXT;
--> statement-breakpoint
-- invoices: void reason, revision ref, and the deprecated `lineItems` alias of `items`.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS void_reason TEXT;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS revised_from TEXT;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS legacy_line_items JSONB;
