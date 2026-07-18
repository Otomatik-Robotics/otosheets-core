import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { analyticsEvents } from '../pg/schema/analytics';
import type {
    AnalyticsEventInput, AnalyticsOverview, AnalyticsDailyRow, AnalyticsPageRow,
    AnalyticsReferrerRow, AnalyticsFunnelRow, AnalyticsHeatmap, VpBucket, FunnelStep,
} from './schema';

/**
 * Postgres-only analytics repo (POSTGRES_MIGRATION_PLAN.md §8 reporting layer +
 * docs/design/WEBSITE_ANALYTICS_ENGINE_PLAN.md). NO DynamoDB anywhere.
 *
 * WRITE — `insertEvents`: the collect endpoint inserts raw beacon events; PK
 * (site_id, event_id) dedupes beacon retries via ON CONFLICT DO NOTHING.
 * READ — the dashboard computes every figure on read with SQL over the raw rows.
 * At first-party storefront volume this is exact and cheap (indexed by site+day),
 * and it makes the numbers correct by construction: sessions/visitors are
 * COUNT(DISTINCT …), the funnel counts distinct sessions per step (clamped
 * monotonic), and scroll is cumulative (sessions reaching at least each depth).
 */
export class AnalyticsPgRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    async insertEvents(events: AnalyticsEventInput[]): Promise<void> {
        if (!events.length) return;
        const rows = events.map(e => ({
            siteId: e.siteId, eventId: e.eventId, day: e.day, ts: new Date(e.ts),
            type: e.type, sid: e.sid, vid: e.vid, path: e.path,
            ref: e.ref ?? null, utmSource: e.utmSource ?? null, utmMedium: e.utmMedium ?? null, utmCampaign: e.utmCampaign ?? null,
            vpBucket: e.vpBucket, x: e.x ?? null, y: e.y ?? null, pw: e.pw ?? null, depth: e.depth ?? null, sec: e.sec ?? null,
            productId: e.productId ?? null, orderId: e.orderId ?? null,
            ns: e.ns ?? false, nv: e.nv ?? false,
        }));
        await this.db.insert(analyticsEvents).values(rows).onConflictDoNothing();
    }

    // ── Dashboard (compute-on-read) ─────────────────────────────────────────

    private range(siteId: string, fromDay: string, toDay: string) {
        return and(eq(analyticsEvents.siteId, siteId), gte(analyticsEvents.day, fromDay), lte(analyticsEvents.day, toDay));
    }

    /** Per-day pageviews / sessions / visitors / seconds. Orders + revenue are
     *  overlaid by the read handler from the orders table (Stripe truth). */
    async getOverview(siteId: string, fromDay: string, toDay: string): Promise<AnalyticsOverview> {
        const rows = await this.db.select({
            day: analyticsEvents.day,
            pageviews: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'pageview')`,
            sessions: sql<number>`count(distinct ${analyticsEvents.sid})`,
            visitors: sql<number>`count(distinct ${analyticsEvents.vid})`,
            // A visitor is "new" this day if any of that day's events flags nv
            // (first-ever visit). count(distinct … filter) over the vid.
            newVisitors: sql<number>`count(distinct ${analyticsEvents.vid}) filter (where ${analyticsEvents.nv})`,
            totalSeconds: sql<number>`coalesce(sum(${analyticsEvents.sec}), 0)`,
        }).from(analyticsEvents).where(this.range(siteId, fromDay, toDay))
            .groupBy(analyticsEvents.day).orderBy(analyticsEvents.day);

        const timeseries: AnalyticsDailyRow[] = rows.map(r => ({
            day: r.day, pageviews: Number(r.pageviews), sessions: Number(r.sessions),
            visitors: Number(r.visitors), newVisitors: Number(r.newVisitors), bounces: 0,
            totalSeconds: Number(r.totalSeconds), orders: 0, revenueCents: 0,
        }));
        // Totals: distinct across the WHOLE range (a visitor active on two days is
        // one visitor), so re-query rather than summing per-day distincts.
        const totalRow = await this.db.select({
            pageviews: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'pageview')`,
            sessions: sql<number>`count(distinct ${analyticsEvents.sid})`,
            visitors: sql<number>`count(distinct ${analyticsEvents.vid})`,
            newVisitors: sql<number>`count(distinct ${analyticsEvents.vid}) filter (where ${analyticsEvents.nv})`,
            totalSeconds: sql<number>`coalesce(sum(${analyticsEvents.sec}), 0)`,
        }).from(analyticsEvents).where(this.range(siteId, fromDay, toDay));
        const tr = totalRow[0];
        const totals = {
            pageviews: Number(tr?.pageviews ?? 0), sessions: Number(tr?.sessions ?? 0),
            visitors: Number(tr?.visitors ?? 0), newVisitors: Number(tr?.newVisitors ?? 0),
            bounces: 0, totalSeconds: Number(tr?.totalSeconds ?? 0), orders: 0, revenueCents: 0,
        };
        return { totals, timeseries };
    }

    async getTopPages(siteId: string, fromDay: string, toDay: string, limit = 20): Promise<AnalyticsPageRow[]> {
        const rows = await this.db.select({
            path: analyticsEvents.path,
            pageviews: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'pageview')`,
            // avg seconds from the one scroll event each session emits on this page
            totalSeconds: sql<number>`coalesce(sum(${analyticsEvents.sec}) filter (where ${analyticsEvents.type} = 'scroll'), 0)`,
            scrolls: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'scroll')`,
        }).from(analyticsEvents).where(this.range(siteId, fromDay, toDay))
            .groupBy(analyticsEvents.path)
            .having(sql`count(*) filter (where ${analyticsEvents.type} = 'pageview') > 0`)
            .orderBy(sql`count(*) filter (where ${analyticsEvents.type} = 'pageview') desc`)
            .limit(limit);
        return rows.map(r => ({
            path: r.path, pageviews: Number(r.pageviews), entries: 0, exits: 0,
            avgSeconds: Number(r.scrolls) > 0 ? Math.round(Number(r.totalSeconds) / Number(r.scrolls)) : 0,
        }));
    }

    /** Traffic sources — distinct sessions grouped by first-touch source/medium/campaign. */
    async getReferrers(siteId: string, fromDay: string, toDay: string, limit = 20): Promise<AnalyticsReferrerRow[]> {
        // A session's source = its utm_source, else the referrer host, else 'direct'.
        const source = sql<string>`coalesce(nullif(${analyticsEvents.utmSource}, ''), nullif(regexp_replace(coalesce(${analyticsEvents.ref}, ''), '^https?://([^/]+).*$', '\\1'), ''), 'direct')`;
        const medium = sql<string>`coalesce(nullif(${analyticsEvents.utmMedium}, ''), '')`;
        const campaign = sql<string>`coalesce(nullif(${analyticsEvents.utmCampaign}, ''), '')`;
        const rows = await this.db.select({
            source, medium, campaign,
            sessions: sql<number>`count(distinct ${analyticsEvents.sid})`,
        }).from(analyticsEvents)
            .where(and(this.range(siteId, fromDay, toDay), eq(analyticsEvents.type, 'pageview')))
            .groupBy(source, medium, campaign)
            .orderBy(sql`count(distinct ${analyticsEvents.sid}) desc`)
            .limit(limit);
        return rows.map(r => ({
            source: r.source, medium: r.medium, campaign: r.campaign,
            sessions: Number(r.sessions), orders: 0, revenueCents: 0,
        }));
    }

    /** Funnel — distinct sessions reaching each step, clamped so it only ever
     *  narrows (a real funnel never widens step to step). */
    async getFunnel(siteId: string, fromDay: string, toDay: string): Promise<AnalyticsFunnelRow[]> {
        const distinct = (cond: ReturnType<typeof sql>) =>
            sql<number>`count(distinct ${analyticsEvents.sid}) filter (where ${cond})`;
        const r = await this.db.select({
            landing: distinct(sql`${analyticsEvents.type} = 'pageview'`),
            product: distinct(sql`${analyticsEvents.type} = 'pageview' and (${analyticsEvents.path} like '/products/%' or ${analyticsEvents.path} = '/shop')`),
            addToCart: distinct(sql`${analyticsEvents.type} = 'add_to_cart'`),
            checkoutStart: distinct(sql`${analyticsEvents.type} = 'checkout_start'`),
            orderComplete: distinct(sql`${analyticsEvents.type} = 'order_complete'`),
        }).from(analyticsEvents).where(this.range(siteId, fromDay, toDay));

        const raw: [FunnelStep, number][] = [
            ['landing', Number(r[0]?.landing ?? 0)],
            ['product', Number(r[0]?.product ?? 0)],
            ['add_to_cart', Number(r[0]?.addToCart ?? 0)],
            ['checkout_start', Number(r[0]?.checkoutStart ?? 0)],
            ['order_complete', Number(r[0]?.orderComplete ?? 0)],
        ];
        let ceiling = Infinity;
        return raw.map(([step, count]) => {
            const clamped = Math.min(count, ceiling);
            ceiling = clamped;
            return { step, count: clamped };
        });
    }

    /** Exact click points + cumulative scroll (sessions reaching AT LEAST each depth).
     *  x is the fraction of page width (0..1) and y is page-Y px — the REAL clicked
     *  coordinates, only de-duplicated to a sub-pixel grid (0.05% wide × 2px tall)
     *  so identical clicks merge without shifting anything to a bucket centre. */
    async getHeatmap(siteId: string, path: string, vpBucket: VpBucket): Promise<AnalyticsHeatmap> {
        const base = and(eq(analyticsEvents.siteId, siteId), eq(analyticsEvents.path, path), eq(analyticsEvents.vpBucket, vpBucket));
        // Absolute click px, deduped to a 2px grid (keeps exact placement). Only
        // clicks near the render width matter; we render at the MEDIAN width and
        // include all — cross-width outliers are rare at storefront volume.
        const clickRows = await this.db.select({
            x: sql<number>`round((${analyticsEvents.x} / 2.0))::int`,
            y: sql<number>`round((${analyticsEvents.y} / 2.0))::int`,
            clicks: sql<number>`count(*)`,
        }).from(analyticsEvents)
            .where(and(base, eq(analyticsEvents.type, 'click'), sql`${analyticsEvents.x} is not null and ${analyticsEvents.y} is not null`))
            .groupBy(sql`1`, sql`2`);
        // Render width = median page width the clicks were captured at, so the
        // backdrop reflows exactly as visitors saw it and absolute px line up.
        const pwRow = await this.db.select({
            pw: sql<number>`percentile_cont(0.5) within group (order by ${analyticsEvents.pw})`,
        }).from(analyticsEvents)
            .where(and(base, eq(analyticsEvents.type, 'click'), sql`${analyticsEvents.pw} is not null`));
        const DEFAULT_W: Record<string, number> = { desktop: 1280, tablet: 834, mobile: 390 };
        const pageWidth = Math.round(Number(pwRow[0]?.pw ?? 0)) || DEFAULT_W[vpBucket] || 1280;

        // Cumulative: for each 20% mark, distinct sessions whose max depth reached it.
        const marks = [2, 4, 6, 8, 10];
        const scrollRows = await this.db.select({
            reached2: sql<number>`count(distinct ${analyticsEvents.sid}) filter (where ${analyticsEvents.depth} >= 0.2)`,
            reached4: sql<number>`count(distinct ${analyticsEvents.sid}) filter (where ${analyticsEvents.depth} >= 0.4)`,
            reached6: sql<number>`count(distinct ${analyticsEvents.sid}) filter (where ${analyticsEvents.depth} >= 0.6)`,
            reached8: sql<number>`count(distinct ${analyticsEvents.sid}) filter (where ${analyticsEvents.depth} >= 0.8)`,
            reached10: sql<number>`count(distinct ${analyticsEvents.sid}) filter (where ${analyticsEvents.depth} >= 1.0)`,
        }).from(analyticsEvents)
            .where(and(base, eq(analyticsEvents.type, 'scroll')));
        const s = scrollRows[0] ?? {} as any;
        const reachedByMark: Record<number, number> = { 2: Number(s.reached2 ?? 0), 4: Number(s.reached4 ?? 0), 6: Number(s.reached6 ?? 0), 8: Number(s.reached8 ?? 0), 10: Number(s.reached10 ?? 0) };

        return {
            path, vpBucket, pageWidth,
            // ×2 back from the 2px dedupe merge → absolute page px.
            clicks: clickRows.map(c => ({ x: Number(c.x) * 2, y: Number(c.y) * 2, clicks: Number(c.clicks) })),
            scroll: marks.map(m => ({ depthBucket: m, reached: reachedByMark[m] })).filter(x => x.reached > 0),
        };
    }

    /** Retention — delete events older than `beforeDay` (called opportunistically;
     *  storefront volume is low, but this keeps the table from growing unbounded). */
    async deleteOlderThan(beforeDay: string): Promise<void> {
        await this.db.delete(analyticsEvents).where(lte(analyticsEvents.day, beforeDay));
    }
}
