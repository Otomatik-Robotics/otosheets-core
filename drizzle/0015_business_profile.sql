-- Unified business_profile table + attribute all operational data to a profile.
-- See the monorepo plan "Unified business_profile table". Additive + idempotent
-- per the expand-contract rule: every statement is IF NOT EXISTS / guarded so a
-- partial apply heals on re-run. The destructive null-out of the legacy settings
-- blobs (booking_settings.businessProfile, trade_settings tax/branding keys,
-- top-level tax_rate/gst_registered) is deferred to a later contract migration —
-- code stops reading them here, so leaving the data in place keeps any missed
-- reader graceful rather than nulled-to-wrong-default.

-- ─── 1. business_profiles table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_profiles (
    business_profile_id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    business_name text,
    legal_name text,
    trade_name text,
    abn text,
    acn text,
    gst_registered boolean,
    tax_rate numeric(6,3),
    tax_label text,
    phone text,
    business_email text,
    website text,
    address text,
    suburb text,
    state text,
    postcode text,
    bank_details text,
    logo_key text,
    brand_color text,
    accent_color text,
    template text,
    footer_text text,
    payment_instructions text,
    about text,
    service_areas jsonb,
    target_customers jsonb,
    unique_selling_points jsonb,
    common_questions jsonb,
    chatbot_tone text,
    chatbot_instructions text,
    google_review_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS business_profiles_org_idx ON business_profiles (org_id);--> statement-breakpoint

-- ─── 2. active-profile pointer on orgs ───────────────────────────────────────
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS business_profile_id text;--> statement-breakpoint

-- ─── 3. seed one profile per org (merge the four legacy locations) ────────────
-- bp = booking_settings->'businessProfile' (authoritative for gst/contact/AI);
-- ts = trade_settings (authoritative for taxLabel/branding); precedence documented
-- in the plan. Guarded: only orgs without a profile yet.
INSERT INTO business_profiles (
    business_profile_id, org_id,
    business_name, legal_name, trade_name, abn, acn,
    gst_registered, tax_rate, tax_label,
    phone, business_email, website, address, suburb, state, postcode,
    bank_details,
    logo_key, brand_color, accent_color, template, footer_text, payment_instructions,
    about, service_areas, target_customers, unique_selling_points, common_questions,
    chatbot_tone, chatbot_instructions, google_review_url
)
SELECT
    gen_random_uuid()::text,
    o.org_id,
    COALESCE(bp->>'businessName', o.trade_name, o.name),
    o.legal_name,
    o.trade_name,
    COALESCE(bp->>'abn', o.abn),
    bp->>'acn',
    COALESCE((bp->>'gstRegistered')::boolean, o.gst_registered),
    COALESCE(o.tax_rate, NULLIF(bp->>'taxRate','')::numeric, NULLIF(ts->>'taxRate','')::numeric, 10),
    COALESCE(ts->>'taxLabel', bp->>'taxLabel', 'GST'),
    bp->>'phone',
    COALESCE(bp->>'businessEmail', ts->>'email'),
    bp->>'website',
    COALESCE(bp->>'address', ts->>'address'),
    COALESCE(bp->>'suburb', ts->>'suburb'),
    COALESCE(bp->>'state', ts->>'state'),
    COALESCE(bp->>'postcode', ts->>'postcode'),
    bp->>'bankDetails',
    COALESCE(ts->'branding'->>'logoKey', o.logo_url),
    COALESCE(ts->'branding'->>'primaryColor', o.brand_color),
    ts->'branding'->>'accentColor',
    ts->'branding'->>'template',
    ts->'branding'->>'footerText',
    ts->'branding'->>'paymentInstructions',
    bp->>'about',
    bp->'serviceAreas',
    bp->'targetCustomers',
    bp->'uniqueSellingPoints',
    bp->'commonQuestions',
    bp->>'chatbotTone',
    bp->>'chatbotInstructions',
    bp->>'googleReviewUrl'
FROM (
    SELECT
        o.*,
        (o.booking_settings->'businessProfile') AS bp,
        o.trade_settings AS ts
    FROM orgs o
    WHERE o.business_profile_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM business_profiles p WHERE p.org_id = o.org_id)
) o;--> statement-breakpoint

-- point each org at its (single) seeded profile
UPDATE orgs o
SET business_profile_id = p.business_profile_id
FROM business_profiles p
WHERE p.org_id = o.org_id
  AND o.business_profile_id IS NULL;--> statement-breakpoint

-- ─── 4. attribute operational tables (org-scoped) ────────────────────────────
-- Column stays NULLABLE here (expand phase): the Dynamo dual-write mirror upserts
-- full entities that don't yet carry business_profile_id, so a NOT NULL now would
-- break the mirror. Flip to NOT NULL in a contract migration once all writers
-- (pg repos + Dynamo mirror) stamp it.
-- clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS business_profile_id text;--> statement-breakpoint
UPDATE clients t SET business_profile_id = o.business_profile_id FROM orgs o WHERE t.org_id = o.org_id AND t.business_profile_id IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS clients_profile_created_idx ON clients (business_profile_id, created_at DESC);--> statement-breakpoint

-- invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS business_profile_id text;--> statement-breakpoint
UPDATE invoices t SET business_profile_id = o.business_profile_id FROM orgs o WHERE t.org_id = o.org_id AND t.business_profile_id IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invoices_profile_created_idx ON invoices (business_profile_id, created_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invoices_profile_status_due_idx ON invoices (business_profile_id, status, due_date);--> statement-breakpoint

-- invoice_payments
ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS business_profile_id text;--> statement-breakpoint
UPDATE invoice_payments t SET business_profile_id = o.business_profile_id FROM orgs o WHERE t.org_id = o.org_id AND t.business_profile_id IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invoice_payments_profile_date_idx ON invoice_payments (business_profile_id, paid_date DESC);--> statement-breakpoint

-- jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS business_profile_id text;--> statement-breakpoint
UPDATE jobs t SET business_profile_id = o.business_profile_id FROM orgs o WHERE t.org_id = o.org_id AND t.business_profile_id IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_profile_created_idx ON jobs (business_profile_id, created_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_profile_status_idx ON jobs (business_profile_id, status, scheduled_date);--> statement-breakpoint

-- time_entries
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS business_profile_id text;--> statement-breakpoint
UPDATE time_entries t SET business_profile_id = o.business_profile_id FROM orgs o WHERE t.org_id = o.org_id AND t.business_profile_id IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS time_entries_profile_created_idx ON time_entries (business_profile_id, created_at DESC);--> statement-breakpoint

-- price_book_items
ALTER TABLE price_book_items ADD COLUMN IF NOT EXISTS business_profile_id text;--> statement-breakpoint
UPDATE price_book_items t SET business_profile_id = o.business_profile_id FROM orgs o WHERE t.org_id = o.org_id AND t.business_profile_id IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS price_book_profile_idx ON price_book_items (business_profile_id);--> statement-breakpoint

-- receipts
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS business_profile_id text;--> statement-breakpoint
UPDATE receipts t SET business_profile_id = o.business_profile_id FROM orgs o WHERE t.org_id = o.org_id AND t.business_profile_id IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS receipts_profile_created_idx ON receipts (business_profile_id, created_at DESC);--> statement-breakpoint

-- trips
ALTER TABLE trips ADD COLUMN IF NOT EXISTS business_profile_id text;--> statement-breakpoint
UPDATE trips t SET business_profile_id = o.business_profile_id FROM orgs o WHERE t.org_id = o.org_id AND t.business_profile_id IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS trips_profile_created_idx ON trips (business_profile_id, created_at DESC);--> statement-breakpoint

-- pipelines
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS business_profile_id text;--> statement-breakpoint
UPDATE pipelines t SET business_profile_id = o.business_profile_id FROM orgs o WHERE t.org_id = o.org_id AND t.business_profile_id IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pipelines_profile_idx ON pipelines (business_profile_id);--> statement-breakpoint

-- leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS business_profile_id text;--> statement-breakpoint
UPDATE leads t SET business_profile_id = o.business_profile_id FROM orgs o WHERE t.org_id = o.org_id AND t.business_profile_id IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS leads_profile_created_idx ON leads (business_profile_id, created_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS leads_profile_stage_idx ON leads (business_profile_id, stage, created_at DESC);--> statement-breakpoint

-- bookings
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS business_profile_id text;--> statement-breakpoint
UPDATE bookings t SET business_profile_id = o.business_profile_id FROM orgs o WHERE t.org_id = o.org_id AND t.business_profile_id IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bookings_profile_created_idx ON bookings (business_profile_id, created_at DESC);--> statement-breakpoint

-- ─── 5. attribute reporting tables (org optional → NULLABLE) ──────────────────
-- statements + bank_accounts key on organization_id (nullable; guest uploads have
-- no org). Backfill where the org is present; leave NULL otherwise, no NOT NULL.
ALTER TABLE statements ADD COLUMN IF NOT EXISTS business_profile_id text;--> statement-breakpoint
UPDATE statements t SET business_profile_id = o.business_profile_id FROM orgs o WHERE t.organization_id = o.org_id AND t.business_profile_id IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS statements_profile ON statements (business_profile_id, fy);--> statement-breakpoint

ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS business_profile_id text;--> statement-breakpoint
UPDATE bank_accounts t SET business_profile_id = o.business_profile_id FROM orgs o WHERE t.organization_id = o.org_id AND t.business_profile_id IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bank_accounts_profile ON bank_accounts (business_profile_id);
