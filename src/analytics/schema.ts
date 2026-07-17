/**
 * Storefront analytics DTOs — one raw-event insert shape, and the aggregate
 * shapes the dashboard computes on read. First-party only: every number
 * originates from our own beacon (no third-party analytics, no DynamoDB).
 * Design: docs/design/WEBSITE_ANALYTICS_ENGINE_PLAN.md.
 */

export type VpBucket = 'mobile' | 'tablet' | 'desktop';
export type FunnelStep = 'landing' | 'product' | 'add_to_cart' | 'checkout_start' | 'order_complete';

/** One raw event as the collector persists it (server stamps siteId/vid/day/ts). */
export interface AnalyticsEventInput {
    siteId: string;
    eventId: string;
    day: string;    // 'YYYY-MM-DD'
    ts: string;     // ISO
    type: string;
    sid: string;
    vid: string;
    path: string;
    ref?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    vpBucket: VpBucket;
    x?: number;
    y?: number;
    depth?: number;
    sec?: number;
    productId?: string;
    orderId?: string;
    ns?: boolean;
    nv?: boolean;
}

export interface AnalyticsDailyRow {
    day: string; pageviews: number; sessions: number; visitors: number;
    /** Visitors whose FIRST-ever visit was this day (persistent first-party id). */
    newVisitors: number;
    bounces: number;
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
