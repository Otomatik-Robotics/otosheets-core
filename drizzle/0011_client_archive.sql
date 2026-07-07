-- Soft-archive for clients: hide from active lists without deleting (so invoices
-- keep a live client FK to join against). Additive + idempotent per expand-contract.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived BOOLEAN;--> statement-breakpoint
ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived_at TEXT;
