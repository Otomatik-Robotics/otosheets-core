-- Bookkeeping (0046): the asset register, BAS periods, and the receipt review
-- signals the BAS confidence score reads.
--
-- assets and bas_periods are Postgres-only (reporting-layer rule: both exist
-- to be aggregated — a depreciation schedule, a quarter's figures — and have no
-- DynamoDB mirror; forms/ad_campaigns precedent). Money is NUMERIC(12,2)
-- dollars, dates are YYYY-MM-DD TEXT, matching the ops tables they join.
--
-- receipts gains six nullable columns (expand-contract, sparse-safe): when the
-- owner first opened it, when they confirmed its category, and the asset it
-- was promoted to or the fact that the offer was declined. Every existing
-- receipt reads back as never-opened / unconfirmed / not-yet-offered, which is
-- the correct starting state.
CREATE TABLE IF NOT EXISTS assets (
    asset_id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    business_profile_id text,
    owner_id text NOT NULL,
    created_by text,
    name text NOT NULL,
    category text NOT NULL,
    is_car boolean NOT NULL DEFAULT false,
    price_inc_gst numeric(12,2) NOT NULL,
    gst_on_price numeric(12,2) NOT NULL DEFAULT 0,
    business_use_percent numeric(5,2) NOT NULL DEFAULT 100,
    purchase_date text NOT NULL,
    first_used_date text,
    receipt_id text,
    ledger_account_code text,
    notes text,
    status text NOT NULL DEFAULT 'ACTIVE',
    disposal jsonb,
    cost_additions jsonb NOT NULL DEFAULT '[]',
    business_use_reviews jsonb NOT NULL DEFAULT '[]',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assets_org_created_idx ON assets (org_id, created_at DESC, asset_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assets_org_status_idx ON assets (org_id, status);
--> statement-breakpoint
-- Promoting the same receipt twice must yield one asset: the receipt id is the
-- dedupe wall for a retried "promote" POST.
CREATE UNIQUE INDEX IF NOT EXISTS assets_org_receipt_uq ON assets (org_id, receipt_id) WHERE receipt_id IS NOT NULL;
--> statement-breakpoint
-- The confidence score counts these on every BAS read.
CREATE INDEX IF NOT EXISTS assets_org_no_first_use_idx ON assets (org_id) WHERE first_used_date IS NULL AND status = 'ACTIVE';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS bas_periods (
    org_id text NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    period text NOT NULL,
    fy text NOT NULL,
    quarter smallint NOT NULL,
    period_start text NOT NULL,
    period_end text NOT NULL,
    due_date text NOT NULL,
    lodged_at timestamptz,
    lodged_by text,
    figures jsonb,
    confidence smallint,
    reasons jsonb,
    reminder_before_at timestamptz,
    reminder_due_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, period)
);
--> statement-breakpoint
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS opened_at timestamptz;
--> statement-breakpoint
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS opened_by text;
--> statement-breakpoint
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS category_confirmed_at timestamptz;
--> statement-breakpoint
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS category_confirmed_by text;
--> statement-breakpoint
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS asset_id text;
--> statement-breakpoint
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS asset_declined_at timestamptz;
--> statement-breakpoint
-- The "looks like an asset" offer reads only receipts that are neither
-- promoted nor declined, so the partial index carries exactly that set.
CREATE INDEX IF NOT EXISTS receipts_org_asset_candidates_idx ON receipts (org_id) WHERE asset_id IS NULL AND asset_declined_at IS NULL;
