-- Phase 3 (leads-to-book): pipelines, leads, bookings — docs/POSTGRES_MIGRATION_PLAN.md §3.
-- Sparse-safe nullables; date-ish fields TEXT; explicit owner_id; jsonb for arrays/config.
CREATE TABLE IF NOT EXISTS pipelines (
    pipeline_id TEXT PRIMARY KEY,
    org_id      TEXT NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    created_by  TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    stages      JSONB,
    is_default  BOOLEAN,
    sources     JSONB,
    voice_config JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pipelines_org_idx ON pipelines (org_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS leads (
    lead_id     TEXT PRIMARY KEY,
    org_id      TEXT NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    owner_id    TEXT NOT NULL,
    created_by  TEXT NOT NULL,
    source      TEXT,
    pipeline_id TEXT REFERENCES pipelines(pipeline_id) ON DELETE SET NULL,
    ad_id       TEXT,
    channel_id  TEXT,
    page_id     TEXT,
    client_name TEXT,
    client_phone TEXT,
    client_email TEXT,
    sender_profile_name TEXT,
    sender_id   TEXT,
    suburb      TEXT,
    service_type TEXT,
    description TEXT,
    photos      JSONB,
    urgency     TEXT,
    stage       TEXT,
    org_stage   TEXT,
    assigned_to TEXT,
    quoted_amount NUMERIC(12,2),
    booking_id  TEXT,
    booking_date TEXT,
    booking_time TEXT,
    notes       TEXT,
    conversation_summary TEXT,
    do_not_call BOOLEAN,
    stage_history JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS leads_org_created_idx ON leads (org_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS leads_org_stage_idx ON leads (org_id, stage, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS leads_org_source_idx ON leads (org_id, source);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS leads_sender_idx ON leads (org_id, sender_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS leads_pipeline_idx ON leads (pipeline_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS leads_name_trgm ON leads USING gin (client_name gin_trgm_ops);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS bookings (
    booking_id  TEXT PRIMARY KEY,
    org_id      TEXT NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    owner_id    TEXT NOT NULL,
    created_by  TEXT NOT NULL,
    booking_date TEXT,
    start_time  TEXT,
    end_time    TEXT,
    client_name TEXT,
    client_phone TEXT,
    client_email TEXT,
    service_type TEXT,
    suburb      TEXT,
    notes       TEXT,
    status      TEXT,
    source      TEXT,
    source_name TEXT,
    lead_id     TEXT,
    pipeline_id TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bookings_org_created_idx ON bookings (org_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bookings_org_date_idx ON bookings (org_id, booking_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bookings_lead_idx ON bookings (lead_id);
