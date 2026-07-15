-- Shared (cross-tenant) merchant → category cache for statement categorisation.
-- A GLOBAL reference-data prior (NOT org-scoped) built from confident
-- categorisations across all tenants, so common recurring merchants resolve
-- deterministically instead of hitting Bedrock. Sits below a user's own vendor
-- rule in precedence. Stores ONLY the normalised merchant string, a category,
-- an aggregate GST treatment, and distinct-org counts — never amounts,
-- descriptions, or user identifiers. Additive + idempotent per expand-contract.
CREATE TABLE IF NOT EXISTS merchant_category_votes (
    merchant_key TEXT NOT NULL,
    category TEXT NOT NULL,
    org_id TEXT NOT NULL,
    gst_treatment TEXT,
    hits INTEGER NOT NULL DEFAULT 1,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (merchant_key, category, org_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS merchant_cat_votes_key ON merchant_category_votes (merchant_key);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS merchant_categories (
    merchant_key TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    gst_treatment TEXT,
    agree_org_count INTEGER NOT NULL DEFAULT 0,
    total_hits INTEGER NOT NULL DEFAULT 0,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS merchant_categories_agree ON merchant_categories (agree_org_count);
