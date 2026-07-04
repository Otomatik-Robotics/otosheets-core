-- Phase 2 (billing-core): clients, invoices, payments — docs/POSTGRES_MIGRATION_PLAN.md §3/§4.
-- Sparse-safe: optional/defaulted scalars are nullable (no NOT NULL DEFAULT) so pg
-- mirrors DynamoDB's absence; date-ish fields are TEXT to preserve the exact string.
CREATE TABLE IF NOT EXISTS clients (
    client_id       TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    created_by      TEXT NOT NULL,
    is_company      BOOLEAN,
    first_name      TEXT,
    last_name       TEXT,
    name            TEXT NOT NULL,
    email           TEXT,
    phone           TEXT,
    abn             TEXT,
    address         TEXT,
    converted_from_lead_id TEXT,
    converted_at    TEXT,
    payment_link_usage_count INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS clients_org_created_idx ON clients (org_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS clients_name_trgm ON clients USING gin (name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS clients_org_email_idx ON clients (org_id, email);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS clients_org_usage_idx ON clients (org_id, payment_link_usage_count DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS client_contacts (
    contact_id  TEXT PRIMARY KEY,
    client_id   TEXT NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
    first_name  TEXT,
    last_name   TEXT,
    email       TEXT,
    phone       TEXT,
    is_primary  BOOLEAN,
    sort_order  INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS client_contacts_client_idx ON client_contacts (client_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS invoices (
    invoice_id      TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    owner_id        TEXT NOT NULL,
    created_by      TEXT NOT NULL,
    invoice_number  TEXT NOT NULL,
    client_id       TEXT REFERENCES clients(client_id) ON DELETE SET NULL,
    issue_date      TEXT,
    due_date        TEXT,
    status          TEXT,
    subtotal        NUMERIC(12,2),
    gst_mode        TEXT,
    gst_amount      NUMERIC(12,2),
    total_amount    NUMERIC(12,2),
    tax_rate        NUMERIC(6,3),
    tax_label       TEXT,
    paid_amount     NUMERIC(12,2),
    notes           TEXT,
    is_recurring    BOOLEAN,
    recurring_config JSONB,
    is_quote        BOOLEAN,
    is_payment_link BOOLEAN,
    payment_url     TEXT,
    stripe_session_id TEXT,
    link_expires_at TEXT,
    from_time_entries JSONB,
    follow_up_sequence_id TEXT,
    legacy_client_snapshot JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invoices_org_created_idx ON invoices (org_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invoices_org_status_due_idx ON invoices (org_id, status, due_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invoices_client_idx ON invoices (client_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invoices_number_trgm ON invoices USING gin (invoice_number gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invoices_stripe_session_idx ON invoices (stripe_session_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS invoice_line_items (
    line_item_id TEXT PRIMARY KEY,
    invoice_id   TEXT NOT NULL REFERENCES invoices(invoice_id) ON DELETE CASCADE,
    description  TEXT NOT NULL,
    quantity     NUMERIC(12,3),
    unit_price   NUMERIC(12,2),
    total        NUMERIC(12,2),
    sort_order   INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_idx ON invoice_line_items (invoice_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS invoice_payments (
    payment_id  TEXT PRIMARY KEY,
    invoice_id  TEXT NOT NULL REFERENCES invoices(invoice_id) ON DELETE CASCADE,
    org_id      TEXT NOT NULL REFERENCES orgs(org_id),
    user_id     TEXT NOT NULL,
    amount      NUMERIC(12,2) NOT NULL,
    method      TEXT NOT NULL,
    paid_date   TEXT,
    note        TEXT,
    stripe_payment_intent_id TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invoice_payments_invoice_idx ON invoice_payments (invoice_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invoice_payments_org_date_idx ON invoice_payments (org_id, paid_date DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS invoice_payments_stripe_pi_uq ON invoice_payments (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
