import { and, eq, gte, lte, sql, desc } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import {
    analyticsDaily, analyticsPageDaily, analyticsReferrerDaily, analyticsFunnelDaily,
    analyticsHeatmapBins, analyticsScrollBins, analyticsRollupCursor,
} from '../pg/schema/analytics';
import type {
    AnalyticsRollupDelta, AnalyticsOverview, AnalyticsDailyRow, AnalyticsPageRow,
    AnalyticsReferrerRow, AnalyticsFunnelRow, AnalyticsHeatmap, VpBucket, FunnelStep,
} from './schema';

/**
 * Postgres-only analytics repo (POSTGRES_MIGRATION_PLAN.md §8 reporting layer +
 * docs/design/WEBSITE_ANALYTICS_ENGINE_PLAN.md). Two halves:
 *
 * WRITE — `applyRollupDelta`: the backend's 5-min cron aggregates raw DynamoDB
 * events into an additive delta and applies it here. Every upsert is a commutative
 * `ON CONFLICT … DO UPDATE SET x = x + excluded.x`, and the (site, day) cursor is
 * the idempotency guard: the delta is applied ONLY if the stored cursor still
 * matches the `fromSk` the caller read — an EventBridge double-fire loses the
 * cursor CAS and applies nothing, so re-runs converge.
 *
 * READ — dashboard queries. Aggregates only, range filters in SQL (never
 * in-memory), tiny indexed rows. There is deliberately no Dynamo implementation:
 * raw events are not for reading.
 */
export class AnalyticsPgRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    // ── Rollup (write path) ──────────────────────────────────────────────────

    async getCursor(siteId: string, day: string): Promise<string> {
        const rows = await this.db.select({ lastSk: analyticsRollupCursor.lastSk })
            .from(analyticsRollupCursor)
            .where(and(eq(analyticsRollupCursor.siteId, siteId), eq(analyticsRollupCursor.day, day)))
            .limit(1);
        return rows[0]?.lastSk ?? '';
    }

    /**
     * Apply one incremental delta. `fromSk` must equal the cursor the caller read
     * before aggregating; the cursor row is CAS-advanced FIRST — if that write
     * doesn't win (double-fire, concurrent run), nothing else is applied.
     */
    async applyRollupDelta(delta: AnalyticsRollupDelta, fromSk: string): Promise<boolean> {
        const db = this.db;
        const { siteId, day } = delta;
        const now = new Date().toISOString();

        // CAS the cursor: insert-if-absent (only when starting from ''), else
        // advance only if last_sk still equals what the caller read.
        const advanced = await db.insert(analyticsRollupCursor)
            .values({ siteId, day, lastSk: delta.lastSk, updatedAt: now })
            .onConflictDoUpdate({
                target: [analyticsRollupCursor.siteId, analyticsRollupCursor.day],
                set: { lastSk: delta.lastSk, updatedAt: now },
                setWhere: sql`${analyticsRollupCursor.lastSk} = ${fromSk}`,
            })
            .returning({ lastSk: analyticsRollupCursor.lastSk });
        if (!advanced.length || advanced[0].lastSk !== delta.lastSk) return false; // lost the CAS — someone else applied this window

        const d = delta.daily;
        await db.insert(analyticsDaily)
            .values({ siteId, day, pageviews: d.pageviews, sessions: d.sessions, visitors: d.visitors, bounces: d.bounces, totalSeconds: d.totalSeconds, orders: d.orders, revenueCents: d.revenueCents })
            .onConflictDoUpdate({
                target: [analyticsDaily.siteId, analyticsDaily.day],
                set: {
                    pageviews: sql`${analyticsDaily.pageviews} + ${d.pageviews}`,
                    sessions: sql`${analyticsDaily.sessions} + ${d.sessions}`,
                    visitors: sql`${analyticsDaily.visitors} + ${d.visitors}`,
                    bounces: sql`${analyticsDaily.bounces} + ${d.bounces}`,
                    totalSeconds: sql`${analyticsDaily.totalSeconds} + ${d.totalSeconds}`,
                    orders: sql`${analyticsDaily.orders} + ${d.orders}`,
                    revenueCents: sql`${analyticsDaily.revenueCents} + ${d.revenueCents}`,
                },
            });

        for (const p of delta.pages) {
            await db.insert(analyticsPageDaily)
                .values({ siteId, day, path: p.path, pageviews: p.pageviews, entries: p.entries, exits: p.exits, totalSeconds: p.totalSeconds })
                .onConflictDoUpdate({
                    target: [analyticsPageDaily.siteId, analyticsPageDaily.day, analyticsPageDaily.path],
                    set: {
                        pageviews: sql`${analyticsPageDaily.pageviews} + ${p.pageviews}`,
                        entries: sql`${analyticsPageDaily.entries} + ${p.entries}`,
                        exits: sql`${analyticsPageDaily.exits} + ${p.exits}`,
                        totalSeconds: sql`${analyticsPageDaily.totalSeconds} + ${p.totalSeconds}`,
                    },
                });
        }

        for (const r of delta.referrers) {
            await db.insert(analyticsReferrerDaily)
                .values({ siteId, day, source: r.source, medium: r.medium, campaign: r.campaign, sessions: r.sessions, orders: r.orders, revenueCents: r.revenueCents })
                .onConflictDoUpdate({
                    target: [analyticsReferrerDaily.siteId, analyticsReferrerDaily.day, analyticsReferrerDaily.source, analyticsReferrerDaily.medium, analyticsReferrerDaily.campaign],
                    set: {
                        sessions: sql`${analyticsReferrerDaily.sessions} + ${r.sessions}`,
                        orders: sql`${analyticsReferrerDaily.orders} + ${r.orders}`,
                        revenueCents: sql`${analyticsReferrerDaily.revenueCents} + ${r.revenueCents}`,
                    },
                });
        }

        for (const f of delta.funnel) {
            await db.insert(analyticsFunnelDaily)
                .values({ siteId, day, step: f.step, count: f.count })
                .onConflictDoUpdate({
                    target: [analyticsFunnelDaily.siteId, analyticsFunnelDaily.day, analyticsFunnelDaily.step],
                    set: { count: sql`${analyticsFunnelDaily.count} + ${f.count}` },
                });
        }

        for (const h of delta.heatmap) {
            await db.insert(analyticsHeatmapBins)
                .values({ siteId, path: h.path, vpBucket: h.vpBucket, gx: h.gx, gy: h.gy, clicks: h.clicks })
                .onConflictDoUpdate({
                    target: [analyticsHeatmapBins.siteId, analyticsHeatmapBins.path, analyticsHeatmapBins.vpBucket, analyticsHeatmapBins.gx, analyticsHeatmapBins.gy],
                    set: { clicks: sql`${analyticsHeatmapBins.clicks} + ${h.clicks}` },
                });
        }

        for (const s of delta.scroll) {
            await db.insert(analyticsScrollBins)
                .values({ siteId, path: s.path, vpBucket: s.vpBucket, depthBucket: s.depthBucket, reached: s.reached })
                .onConflictDoUpdate({
                    target: [analyticsScrollBins.siteId, analyticsScrollBins.path, analyticsScrollBins.vpBucket, analyticsScrollBins.depthBucket],
                    set: { reached: sql`${analyticsScrollBins.reached} + ${s.reached}` },
                });
        }
        return true;
    }

    // ── Dashboard (read path) ────────────────────────────────────────────────

    async getOverview(siteId: string, fromDay: string, toDay: string): Promise<AnalyticsOverview> {
        const rows = await this.db.select().from(analyticsDaily)
            .where(and(eq(analyticsDaily.siteId, siteId), gte(analyticsDaily.day, fromDay), lte(analyticsDaily.day, toDay)))
            .orderBy(analyticsDaily.day);
        const timeseries: AnalyticsDailyRow[] = rows.map(r => ({
            day: r.day, pageviews: r.pageviews, sessions: r.sessions, visitors: r.visitors,
            bounces: r.bounces, totalSeconds: r.totalSeconds, orders: r.orders, revenueCents: r.revenueCents,
        }));
        const totals = timeseries.reduce((t, r) => ({
            pageviews: t.pageviews + r.pageviews, sessions: t.sessions + r.sessions,
            visitors: t.visitors + r.visitors, bounces: t.bounces + r.bounces,
            totalSeconds: t.totalSeconds + r.totalSeconds, orders: t.orders + r.orders,
            revenueCents: t.revenueCents + r.revenueCents,
        }), { pageviews: 0, sessions: 0, visitors: 0, bounces: 0, totalSeconds: 0, orders: 0, revenueCents: 0 });
        return { totals, timeseries };
    }

    async getTopPages(siteId: string, fromDay: string, toDay: string, limit = 20): Promise<AnalyticsPageRow[]> {
        const rows = await this.db.select({
            path: analyticsPageDaily.path,
            pageviews: sql<number>`sum(${analyticsPageDaily.pageviews})`,
            entries: sql<number>`sum(${analyticsPageDaily.entries})`,
            exits: sql<number>`sum(${analyticsPageDaily.exits})`,
            totalSeconds: sql<number>`sum(${analyticsPageDaily.totalSeconds})`,
        }).from(analyticsPageDaily)
            .where(and(eq(analyticsPageDaily.siteId, siteId), gte(analyticsPageDaily.day, fromDay), lte(analyticsPageDaily.day, toDay)))
            .groupBy(analyticsPageDaily.path)
            .orderBy(desc(sql`sum(${analyticsPageDaily.pageviews})`))
            .limit(limit);
        return rows.map(r => ({
            path: r.path, pageviews: Number(r.pageviews), entries: Number(r.entries), exits: Number(r.exits),
            avgSeconds: Number(r.pageviews) > 0 ? Math.round(Number(r.totalSeconds) / Number(r.pageviews)) : 0,
        }));
    }

    async getReferrers(siteId: string, fromDay: string, toDay: string, limit = 20): Promise<AnalyticsReferrerRow[]> {
        const rows = await this.db.select({
            source: analyticsReferrerDaily.source,
            medium: analyticsReferrerDaily.medium,
            campaign: analyticsReferrerDaily.campaign,
            sessions: sql<number>`sum(${analyticsReferrerDaily.sessions})`,
            orders: sql<number>`sum(${analyticsReferrerDaily.orders})`,
            revenueCents: sql<number>`sum(${analyticsReferrerDaily.revenueCents})`,
        }).from(analyticsReferrerDaily)
            .where(and(eq(analyticsReferrerDaily.siteId, siteId), gte(analyticsReferrerDaily.day, fromDay), lte(analyticsReferrerDaily.day, toDay)))
            .groupBy(analyticsReferrerDaily.source, analyticsReferrerDaily.medium, analyticsReferrerDaily.campaign)
            .orderBy(desc(sql`sum(${analyticsReferrerDaily.sessions})`))
            .limit(limit);
        return rows.map(r => ({
            source: r.source, medium: r.medium, campaign: r.campaign,
            sessions: Number(r.sessions), orders: Number(r.orders), revenueCents: Number(r.revenueCents),
        }));
    }

    async getFunnel(siteId: string, fromDay: string, toDay: string): Promise<AnalyticsFunnelRow[]> {
        const rows = await this.db.select({
            step: analyticsFunnelDaily.step,
            count: sql<number>`sum(${analyticsFunnelDaily.count})`,
        }).from(analyticsFunnelDaily)
            .where(and(eq(analyticsFunnelDaily.siteId, siteId), gte(analyticsFunnelDaily.day, fromDay), lte(analyticsFunnelDaily.day, toDay)))
            .groupBy(analyticsFunnelDaily.step);
        const order: FunnelStep[] = ['landing', 'product', 'add_to_cart', 'checkout_start', 'order_complete'];
        const byStep = new Map(rows.map(r => [r.step, Number(r.count)]));
        return order.map(step => ({ step, count: byStep.get(step) ?? 0 }));
    }

    async getHeatmap(siteId: string, path: string, vpBucket: VpBucket): Promise<AnalyticsHeatmap> {
        const clicks = await this.db.select({
            gx: analyticsHeatmapBins.gx, gy: analyticsHeatmapBins.gy, clicks: analyticsHeatmapBins.clicks,
        }).from(analyticsHeatmapBins)
            .where(and(eq(analyticsHeatmapBins.siteId, siteId), eq(analyticsHeatmapBins.path, path), eq(analyticsHeatmapBins.vpBucket, vpBucket)));
        const scroll = await this.db.select({
            depthBucket: analyticsScrollBins.depthBucket, reached: analyticsScrollBins.reached,
        }).from(analyticsScrollBins)
            .where(and(eq(analyticsScrollBins.siteId, siteId), eq(analyticsScrollBins.path, path), eq(analyticsScrollBins.vpBucket, vpBucket)));
        return {
            path, vpBucket,
            clicks: clicks.map(c => ({ gx: c.gx, gy: c.gy, clicks: c.clicks })),
            scroll: scroll.map(s => ({ depthBucket: s.depthBucket, reached: s.reached })).sort((a, b) => a.depthBucket - b.depthBucket),
        };
    }
}
