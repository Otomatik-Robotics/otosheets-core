-- Storefront analytics raw events — Postgres end to end (no DynamoDB). The
-- dashboard computes every figure on read with SQL over these rows. Additive +
-- idempotent per the expand-contract rule.
CREATE TABLE IF NOT EXISTS analytics_events (
    site_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    day TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL,
    type TEXT NOT NULL,
    sid TEXT NOT NULL DEFAULT '',
    vid TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL DEFAULT '/',
    ref TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    vp_bucket TEXT NOT NULL DEFAULT 'desktop',
    x DOUBLE PRECISION,
    y INTEGER,
    depth DOUBLE PRECISION,
    sec INTEGER,
    product_id TEXT,
    order_id TEXT,
    ns BOOLEAN NOT NULL DEFAULT FALSE,
    nv BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (site_id, event_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS analytics_events_site_day_idx ON analytics_events (site_id, day);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS analytics_events_site_path_type_idx ON analytics_events (site_id, path, type);
