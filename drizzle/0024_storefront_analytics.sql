-- Storefront analytics aggregates (docs/design/WEBSITE_ANALYTICS_ENGINE_PLAN.md).
-- Raw events stay in DynamoDB (TTL'd); these are the rollup targets the dashboard
-- reads. Additive + idempotent per the expand-contract rule.
CREATE TABLE IF NOT EXISTS analytics_daily (
    site_id TEXT NOT NULL,
    day TEXT NOT NULL,
    pageviews BIGINT NOT NULL DEFAULT 0,
    sessions BIGINT NOT NULL DEFAULT 0,
    visitors BIGINT NOT NULL DEFAULT 0,
    bounces BIGINT NOT NULL DEFAULT 0,
    total_seconds BIGINT NOT NULL DEFAULT 0,
    orders BIGINT NOT NULL DEFAULT 0,
    revenue_cents BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (site_id, day)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS analytics_page_daily (
    site_id TEXT NOT NULL,
    day TEXT NOT NULL,
    path TEXT NOT NULL,
    pageviews BIGINT NOT NULL DEFAULT 0,
    entries BIGINT NOT NULL DEFAULT 0,
    exits BIGINT NOT NULL DEFAULT 0,
    total_seconds BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (site_id, day, path)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS analytics_page_daily_site_day_idx ON analytics_page_daily (site_id, day);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS analytics_referrer_daily (
    site_id TEXT NOT NULL,
    day TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    medium TEXT NOT NULL DEFAULT '',
    campaign TEXT NOT NULL DEFAULT '',
    sessions BIGINT NOT NULL DEFAULT 0,
    orders BIGINT NOT NULL DEFAULT 0,
    revenue_cents BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (site_id, day, source, medium, campaign)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS analytics_referrer_daily_site_day_idx ON analytics_referrer_daily (site_id, day);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS analytics_funnel_daily (
    site_id TEXT NOT NULL,
    day TEXT NOT NULL,
    step TEXT NOT NULL,
    count BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (site_id, day, step)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS analytics_heatmap_bins (
    site_id TEXT NOT NULL,
    path TEXT NOT NULL,
    vp_bucket TEXT NOT NULL,
    gx INTEGER NOT NULL,
    gy INTEGER NOT NULL,
    clicks BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (site_id, path, vp_bucket, gx, gy)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS analytics_heatmap_site_path_idx ON analytics_heatmap_bins (site_id, path);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS analytics_scroll_bins (
    site_id TEXT NOT NULL,
    path TEXT NOT NULL,
    vp_bucket TEXT NOT NULL,
    depth_bucket INTEGER NOT NULL,
    reached BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (site_id, path, vp_bucket, depth_bucket)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS analytics_rollup_cursor (
    site_id TEXT NOT NULL,
    day TEXT NOT NULL,
    last_sk TEXT NOT NULL DEFAULT '',
    updated_at TEXT,
    PRIMARY KEY (site_id, day)
);
