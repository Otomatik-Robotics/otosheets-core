import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { AnalyticsPgRepo } from './repo.pg';
import type { AnalyticsRollupDelta } from './schema';

let db: PgDb;
let repo: AnalyticsPgRepo;

const delta = (over: Partial<AnalyticsRollupDelta> = {}): AnalyticsRollupDelta => ({
    siteId: 'site_1', day: '2026-07-17',
    daily: { pageviews: 10, sessions: 4, visitors: 3, bounces: 1, totalSeconds: 300, orders: 1, revenueCents: 4900 },
    pages: [{ path: '/', pageviews: 6, entries: 4, exits: 2, totalSeconds: 200 }, { path: '/products/widget', pageviews: 4, entries: 0, exits: 2, totalSeconds: 100 }],
    referrers: [{ source: 'google.com', medium: '', campaign: '', sessions: 3, orders: 1, revenueCents: 4900 }],
    funnel: [{ step: 'landing', count: 4 }, { step: 'product', count: 2 }, { step: 'order_complete', count: 1 }],
    heatmap: [{ path: '/', vpBucket: 'desktop', gx: 21, gy: 69, clicks: 5 }],
    scroll: [{ path: '/', vpBucket: 'desktop', depthBucket: 7, reached: 3 }],
    lastSk: '1721190000000#01AAA',
    ...over,
});

beforeAll(async () => {
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    repo = new AnalyticsPgRepo(db);
});

describe('AnalyticsPgRepo', () => {
    it('applies a delta and reads it back through the dashboard queries', async () => {
        expect(await repo.getCursor('site_1', '2026-07-17')).toBe('');
        expect(await repo.applyRollupDelta(delta(), '')).toBe(true);

        const o = await repo.getOverview('site_1', '2026-07-01', '2026-07-31');
        expect(o.totals.pageviews).toBe(10);
        expect(o.totals.revenueCents).toBe(4900);
        expect(o.timeseries).toHaveLength(1);

        const pages = await repo.getTopPages('site_1', '2026-07-01', '2026-07-31');
        expect(pages[0]).toMatchObject({ path: '/', pageviews: 6, avgSeconds: 33 });

        const funnel = await repo.getFunnel('site_1', '2026-07-01', '2026-07-31');
        expect(funnel.find(f => f.step === 'landing')?.count).toBe(4);
        expect(funnel.find(f => f.step === 'add_to_cart')?.count).toBe(0); // absent step reads as 0

        const heat = await repo.getHeatmap('site_1', '/', 'desktop');
        expect(heat.clicks).toEqual([{ gx: 21, gy: 69, clicks: 5 }]);
        expect(heat.scroll).toEqual([{ depthBucket: 7, reached: 3 }]);
    });

    it('sums commutatively on a second window', async () => {
        expect(await repo.applyRollupDelta(delta({ lastSk: '1721193600000#01BBB' }), '1721190000000#01AAA')).toBe(true);
        const o = await repo.getOverview('site_1', '2026-07-17', '2026-07-17');
        expect(o.totals.pageviews).toBe(20);
        const heat = await repo.getHeatmap('site_1', '/', 'desktop');
        expect(heat.clicks[0].clicks).toBe(10);
    });

    it('cron double-fire loses the cursor CAS and applies nothing', async () => {
        // Same window re-applied with a stale fromSk: cursor no longer matches.
        expect(await repo.applyRollupDelta(delta({ lastSk: '1721193600000#01BBB' }), '1721190000000#01AAA')).toBe(false);
        const o = await repo.getOverview('site_1', '2026-07-17', '2026-07-17');
        expect(o.totals.pageviews).toBe(20); // unchanged — converged, not double-counted
    });

    it('scopes reads by site', async () => {
        const o = await repo.getOverview('site_other', '2026-07-01', '2026-07-31');
        expect(o.totals.pageviews).toBe(0);
        expect(o.timeseries).toHaveLength(0);
    });
});
