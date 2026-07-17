/**
 * Storefront analytics DTOs — the rollup delta the backend cron computes from raw
 * DynamoDB events, and the aggregate shapes the dashboard reads. First-party only:
 * every number originates from our own beacon (no third-party analytics anywhere).
 * Design: docs/design/WEBSITE_ANALYTICS_ENGINE_PLAN.md.
 */

export type VpBucket = 'mobile' | 'tablet' | 'desktop';
export type FunnelStep = 'landing' | 'product' | 'add_to_cart' | 'checkout_start' | 'order_complete';

/** One incremental rollup window's additive contribution for a (site, day). */
export interface AnalyticsRollupDelta {
    siteId: string;
    day: string; // 'YYYY-MM-DD'
    daily: {
        pageviews: number; sessions: number; visitors: number; bounces: number;
        totalSeconds: number; orders: number; revenueCents: number;
    };
    pages: { path: string; pageviews: number; entries: number; exits: number; totalSeconds: number }[];
    referrers: { source: string; medium: string; campaign: string; sessions: number; orders: number; revenueCents: number }[];
    funnel: { step: FunnelStep; count: number }[];
    heatmap: { path: string; vpBucket: VpBucket; gx: number; gy: number; clicks: number }[];
    scroll: { path: string; vpBucket: VpBucket; depthBucket: number; reached: number }[];
    /** Raw sk high-water mark for this window — persisted with the delta so a
     *  cron double-fire converges (same cursor → delta already applied → skip). */
    lastSk: string;
}

export interface AnalyticsDailyRow {
    day: string; pageviews: number; sessions: number; visitors: number; bounces: number;
    totalSeconds: number; orders: number; revenueCents: number;
}
export interface AnalyticsOverview {
    totals: Omit<AnalyticsDailyRow, 'day'>;
    timeseries: AnalyticsDailyRow[];
}
export interface AnalyticsPageRow {
    path: string; pageviews: number; entries: number; exits: number; avgSeconds: number;
}
export interface AnalyticsReferrerRow {
    source: string; medium: string; campaign: string; sessions: number; orders: number; revenueCents: number;
}
export interface AnalyticsFunnelRow { step: FunnelStep; count: number }
export interface AnalyticsHeatmap {
    path: string; vpBucket: VpBucket;
    clicks: { gx: number; gy: number; clicks: number }[];
    scroll: { depthBucket: number; reached: number }[];
}
