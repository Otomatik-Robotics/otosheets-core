import { pgTable, text, bigint, integer, primaryKey, index } from 'drizzle-orm/pg-core';

/**
 * Storefront analytics — AGGREGATES ONLY (docs/design/WEBSITE_ANALYTICS_ENGINE_PLAN.md).
 *
 * Raw events live in DynamoDB (`AnalyticsEvents`, TTL'd) — keyed/ephemeral/hot-path,
 * per the platform's source-of-truth rule. The 5-min rollup folds them into these
 * pre-aggregated tables; the dashboard only ever reads these. All sums are additive
 * and keyed by (site_id, day, …) so rollup upserts are commutative
 * (`ON CONFLICT … DO UPDATE SET x = x + excluded.x`) and re-runs converge.
 *
 * `site_id` is the storefront's Dynamo site key (sites stay on DynamoDB, PK=host) —
 * a plain text key here, no FK by design. First-party by construction: every row
 * derives from our own beacon; no third-party analytics vendor anywhere.
 */
export const analyticsDaily = pgTable('analytics_daily', {
    siteId: text('site_id').notNull(),
    day: text('day').notNull(),                       // 'YYYY-MM-DD'
    pageviews: bigint('pageviews', { mode: 'number' }).notNull().default(0),
    sessions: bigint('sessions', { mode: 'number' }).notNull().default(0),
    visitors: bigint('visitors', { mode: 'number' }).notNull().default(0),
    bounces: bigint('bounces', { mode: 'number' }).notNull().default(0),
    totalSeconds: bigint('total_seconds', { mode: 'number' }).notNull().default(0),
    orders: bigint('orders', { mode: 'number' }).notNull().default(0),
    revenueCents: bigint('revenue_cents', { mode: 'number' }).notNull().default(0),
}, (t) => [primaryKey({ columns: [t.siteId, t.day] })]);

export const analyticsPageDaily = pgTable('analytics_page_daily', {
    siteId: text('site_id').notNull(),
    day: text('day').notNull(),
    path: text('path').notNull(),
    pageviews: bigint('pageviews', { mode: 'number' }).notNull().default(0),
    entries: bigint('entries', { mode: 'number' }).notNull().default(0),
    exits: bigint('exits', { mode: 'number' }).notNull().default(0),
    totalSeconds: bigint('total_seconds', { mode: 'number' }).notNull().default(0),
}, (t) => [
    primaryKey({ columns: [t.siteId, t.day, t.path] }),
    index('analytics_page_daily_site_day_idx').on(t.siteId, t.day),
]);

export const analyticsReferrerDaily = pgTable('analytics_referrer_daily', {
    siteId: text('site_id').notNull(),
    day: text('day').notNull(),
    source: text('source').notNull().default(''),      // referrer host or utm_source
    medium: text('medium').notNull().default(''),
    campaign: text('campaign').notNull().default(''),
    sessions: bigint('sessions', { mode: 'number' }).notNull().default(0),
    orders: bigint('orders', { mode: 'number' }).notNull().default(0),
    revenueCents: bigint('revenue_cents', { mode: 'number' }).notNull().default(0),
}, (t) => [
    primaryKey({ columns: [t.siteId, t.day, t.source, t.medium, t.campaign] }),
    index('analytics_referrer_daily_site_day_idx').on(t.siteId, t.day),
]);

export const analyticsFunnelDaily = pgTable('analytics_funnel_daily', {
    siteId: text('site_id').notNull(),
    day: text('day').notNull(),
    step: text('step').notNull(),                      // landing|product|add_to_cart|checkout_start|order_complete
    count: bigint('count', { mode: 'number' }).notNull().default(0),
}, (t) => [primaryKey({ columns: [t.siteId, t.day, t.step] })]);

/** Click heatmap — clicks binned to a resolution-independent grid: gx = floor(x*50)
 *  (x normalized 0–1 to page width), gy = floor(yPx/20). vp_bucket keeps
 *  mobile/tablet/desktop maps separate. Cumulative (not per-day) — the map is the
 *  page's lifetime attention picture; a per-day variant can be added if needed. */
export const analyticsHeatmapBins = pgTable('analytics_heatmap_bins', {
    siteId: text('site_id').notNull(),
    path: text('path').notNull(),
    vpBucket: text('vp_bucket').notNull(),             // mobile|tablet|desktop
    gx: integer('gx').notNull(),
    gy: integer('gy').notNull(),
    clicks: bigint('clicks', { mode: 'number' }).notNull().default(0),
}, (t) => [
    primaryKey({ columns: [t.siteId, t.path, t.vpBucket, t.gx, t.gy] }),
    index('analytics_heatmap_site_path_idx').on(t.siteId, t.path),
]);

/** Scroll attention — how many sessions reached each 10%-depth bucket per page. */
export const analyticsScrollBins = pgTable('analytics_scroll_bins', {
    siteId: text('site_id').notNull(),
    path: text('path').notNull(),
    vpBucket: text('vp_bucket').notNull(),
    depthBucket: integer('depth_bucket').notNull(),    // 0..10 (0–100% in 10% steps)
    reached: bigint('reached', { mode: 'number' }).notNull().default(0),
}, (t) => [primaryKey({ columns: [t.siteId, t.path, t.vpBucket, t.depthBucket] })]);

/** Rollup cursor — last raw sk processed per (site, day) partition, so the 5-min
 *  cron is incremental and an EventBridge double-fire re-reads nothing. */
export const analyticsRollupCursor = pgTable('analytics_rollup_cursor', {
    siteId: text('site_id').notNull(),
    day: text('day').notNull(),
    lastSk: text('last_sk').notNull().default(''),
    updatedAt: text('updated_at'),
}, (t) => [primaryKey({ columns: [t.siteId, t.day] })]);
