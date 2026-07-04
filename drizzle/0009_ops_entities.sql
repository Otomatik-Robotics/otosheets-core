-- Phase 4 (ops & expenses): jobs, time_entries, price_book_items, receipts, trips.
-- Sparse-safe nullables; date-ish TEXT; explicit owner_id. receipts/trips have no updated_at.
CREATE TABLE IF NOT EXISTS jobs (
    job_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    client_id TEXT REFERENCES clients(client_id) ON DELETE SET NULL,
    lead_id TEXT,
    title TEXT,
    description TEXT,
    status TEXT,
    address TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    scheduled_date TEXT,
    scheduled_time TEXT,
    estimated_duration INTEGER,
    assigned_members JSONB,
    assigned_teams JSONB,
    scope TEXT,
    job_type TEXT,
    geofence JSONB,
    materials JSONB,
    photos JSONB,
    started_at TEXT,
    completed_at TEXT,
    signature_key TEXT,
    handover_notes TEXT,
    handover_token TEXT,
    location_pings JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_org_created_idx ON jobs (org_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_org_status_idx ON jobs (org_id, status, scheduled_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_client_idx ON jobs (client_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_org_sched_idx ON jobs (org_id, scheduled_date);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS time_entries (
    time_entry_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    client_id TEXT,
    job_id TEXT,
    entry_date TEXT,
    start_time TEXT,
    end_time TEXT,
    duration_minutes INTEGER,
    description TEXT,
    project TEXT,
    billable BOOLEAN,
    invoiced_at TEXT,
    invoice_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS time_entries_org_created_idx ON time_entries (org_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS time_entries_job_idx ON time_entries (job_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS time_entries_owner_idx ON time_entries (org_id, owner_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS price_book_items (
    item_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    name TEXT,
    description TEXT,
    unit_price NUMERIC(12,2),
    unit TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS price_book_org_idx ON price_book_items (org_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS receipts (
    receipt_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    s3_key TEXT,
    content_hash TEXT,
    status TEXT,
    vendor_name TEXT,
    total_amount NUMERIC(12,2),
    tax_amount NUMERIC(12,2),
    gst_amount NUMERIC(12,2),
    ex_gst_amount NUMERIC(12,2),
    receipt_date TEXT,
    category TEXT,
    description TEXT,
    ai_risk_level TEXT,
    is_deductible BOOLEAN,
    ai_warning TEXT,
    is_fuel_receipt BOOLEAN,
    business_percent NUMERIC(5,2),
    business_amount NUMERIC(12,2),
    rule_applied BOOLEAN,
    duplicate_of TEXT,
    possible_duplicate_of TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS receipts_org_created_idx ON receipts (org_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS receipts_org_category_idx ON receipts (org_id, category);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS receipts_content_hash_idx ON receipts (org_id, content_hash);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS trips (
    trip_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    start_address TEXT,
    end_address TEXT,
    distance_km NUMERIC(10,2),
    purpose TEXT,
    notes TEXT,
    coordinates JSONB,
    trip_date TEXT,
    job_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS trips_org_created_idx ON trips (org_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS trips_org_date_idx ON trips (org_id, trip_date);
