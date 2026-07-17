import { pgTable, text, bigint, integer, doublePrecision, boolean, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

/**
 * Storefront analytics — Postgres end to end (docs/design/WEBSITE_ANALYTICS_ENGINE_PLAN.md).
 *
 * Raw events land directly in `analytics_events` (below) — NO DynamoDB anywhere in
 * the analytics path. The dashboard computes every figure on read with SQL over the
 * raw rows (COUNT DISTINCT sessions/visitors, session-based monotonic funnel,
 * cumulative scroll), so numbers are exact by construction at first-party
 * storefront volume. (The aggregate tables further down are legacy from the
 * short-lived rollup design and are no longer written or read.)
 */
export const analyticsEvents = pgTable('analytics_events', {
    siteId: text('site_id').notNull(),
    eventId: text('event_id').notNull(),           // client ULID — PK for beacon-retry dedupe
    day: text('day').notNull(),                    // 'YYYY-MM-DD' (UTC) — cheap range/group key
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    type: text('type').notNull(),                  // pageview|click|scroll|form_submit|add_to_cart|checkout_start|order_complete|custom
    sid: text('sid').notNull().default(''),        // session id
    vid: text('vid').notNull().default(''),        // server-computed daily visitor hash
    path: text('path').notNull().default('/'),
    ref: text('ref'),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    vpBucket: text('vp_bucket').notNull().default('desktop'),
    x: doublePrecision('x'),                       // click: 0..1 of page width
    y: integer('y'),                               // click: page-y px
    depth: doublePrecision('depth'),               // scroll: max fraction reached 0..1
    sec: integer('sec'),                           // scroll: seconds on page
    productId: text('product_id'),
    orderId: text('order_id'),
    ns: boolean('ns').notNull().default(false),    // new session (first pageview)
    nv: boolean('nv').notNull().default(false),    // new visitor (first of the day)
}, (t) => [
    primaryKey({ columns: [t.siteId, t.eventId] }),
    index('analytics_events_site_day_idx').on(t.siteId, t.day),
    index('analytics_events_site_path_type_idx').on(t.siteId, t.path, t.type),
]);

/**
 * LEGACY aggregate tables (migration 0024) — from the rollup design that has been
 * replaced by compute-on-read above. Retained so the migration stays additive and
 * old rows aren't orphaned; no code writes or reads them any more.
 *
 * (historical note) All sums were additive and keyed by (site_id, day, …).
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
