import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { AnalyticsPgRepo } from './repo.pg';
import type { AnalyticsEventInput, VpBucket } from './schema';

let db: PgDb;
let repo: AnalyticsPgRepo;
let seq = 0;

const ev = (over: Partial<AnalyticsEventInput>): AnalyticsEventInput => ({
    siteId: 'site_1', eventId: 'e' + (++seq), day: '2026-07-17', ts: '2026-07-17T01:00:00.000Z',
    type: 'pageview', sid: 's1', vid: 'v1', path: '/', vpBucket: 'desktop' as VpBucket, ...over,
});

beforeAll(async () => {
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    repo = new AnalyticsPgRepo(db);
});

describe('AnalyticsPgRepo (compute-on-read)', () => {
    it('insert dedupes on (site, eventId) and computes distinct sessions/visitors', async () => {
        await repo.insertEvents([
            ev({ eventId: 'pv1', sid: 's1', vid: 'v1', path: '/', ns: true, nv: true }),
            ev({ eventId: 'pv2', sid: 's1', vid: 'v1', path: '/shop' }),              // same session
            ev({ eventId: 'pv3', sid: 's2', vid: 'v2', path: '/', ns: true, nv: true }),
        ]);
        await repo.insertEvents([ev({ eventId: 'pv1', sid: 'sX' })]); // retry — ignored
        const o = await repo.getOverview('site_1', '2026-07-01', '2026-07-31');
        expect(o.totals.pageviews).toBe(3);
        expect(o.totals.sessions).toBe(2);   // s1, s2 — not inflated by the 3 pageviews
        expect(o.totals.visitors).toBe(2);
    });

    it('funnel counts distinct sessions per step and never widens', async () => {
        // s1 views 2 products + adds to cart twice; must NOT read as >100%.
        await repo.insertEvents([
            ev({ eventId: 'p_a', sid: 's1', type: 'pageview', path: '/products/widget' }),
            ev({ eventId: 'p_b', sid: 's1', type: 'pageview', path: '/products/gizmo' }),
            ev({ eventId: 'c_a', sid: 's1', type: 'add_to_cart' }),
            ev({ eventId: 'c_b', sid: 's1', type: 'add_to_cart' }),
            ev({ eventId: 'co', sid: 's1', type: 'checkout_start' }),
            ev({ eventId: 'oc', sid: 's1', type: 'order_complete', orderId: 'ord1' }),
        ]);
        const f = await repo.getFunnel('site_1', '2026-07-01', '2026-07-31');
        const by = Object.fromEntries(f.map(s => [s.step, s.count]));
        expect(by.landing).toBe(2);          // s1 + s2 both had a pageview
        expect(by.product).toBe(1);          // only s1 viewed a product
        expect(by.add_to_cart).toBe(1);      // deduped: 2 events, 1 session
        expect(by.checkout_start).toBe(1);
        expect(by.order_complete).toBe(1);
        // monotonic non-increasing
        for (let i = 1; i < f.length; i++) expect(f[i].count).toBeLessThanOrEqual(f[i - 1].count);
    });

    it('scroll is cumulative — sessions reaching AT LEAST each depth', async () => {
        await repo.insertEvents([
            ev({ eventId: 'sc1', sid: 's1', type: 'scroll', path: '/', depth: 1.0, sec: 60 }),
            ev({ eventId: 'sc2', sid: 's2', type: 'scroll', path: '/', depth: 0.5, sec: 20 }),
        ]);
        const h = await repo.getHeatmap('site_1', '/', 'desktop');
        const by = Object.fromEntries(h.scroll.map(s => [s.depthBucket, s.reached]));
        expect(by[4]).toBe(2);   // ≥40%: both s1 (100%) and s2 (50%)
        expect(by[6]).toBe(1);   // ≥60%: only s1
        expect(by[10]).toBe(1);  // ≥100%: only s1
    });

    it('heatmap returns absolute click px + median render width', async () => {
        await repo.insertEvents([
            ev({ eventId: 'ck1', sid: 's1', type: 'click', path: '/', x: 600, y: 1380, pw: 1400 }),
            ev({ eventId: 'ck2', sid: 's2', type: 'click', path: '/', x: 601, y: 1381, pw: 1600 }),
        ]);
        const h = await repo.getHeatmap('site_1', '/', 'desktop');
        const total = h.clicks.reduce((a, c) => a + c.clicks, 0);
        expect(total).toBe(2);                       // both clicks present
        expect(h.clicks.every(c => c.x > 595 && c.x < 605 && c.y > 1375 && c.y < 1385)).toBe(true);
        expect(h.pageWidth).toBe(1500);              // median of 1400 & 1600
    });

    it('heatmap falls back to a device default width when no clicks have pw', async () => {
        const h = await repo.getHeatmap('site_1', '/nowhere', 'mobile');
        expect(h.pageWidth).toBe(390);
    });

    it('top pages rank by pageviews with avg seconds from scroll', async () => {
        const pages = await repo.getTopPages('site_1', '2026-07-01', '2026-07-31');
        const home = pages.find(p => p.path === '/');
        expect(home).toBeTruthy();
        expect(home!.avgSeconds).toBe(40); // (60+20)/2 scroll events
    });

    it('tracks new vs returning visitors via the persistent id + nv flag', async () => {
        // v1 first-ever visit (nv), v2 first-ever visit (nv), then v1 returns (no nv).
        await repo.insertEvents([
            ev({ eventId: 'r1', sid: 'sa', vid: 'v1', type: 'pageview', ns: true, nv: true, day: '2026-07-18', ts: '2026-07-18T01:00:00.000Z' }),
            ev({ eventId: 'r2', sid: 'sb', vid: 'v2', type: 'pageview', ns: true, nv: true, day: '2026-07-18', ts: '2026-07-18T02:00:00.000Z' }),
            ev({ eventId: 'r3', sid: 'sc', vid: 'v1', type: 'pageview', ns: true, nv: false, day: '2026-07-18', ts: '2026-07-18T03:00:00.000Z' }),
        ]);
        const o = await repo.getOverview('site_1', '2026-07-18', '2026-07-18');
        expect(o.totals.visitors).toBe(2);      // v1, v2
        expect(o.totals.newVisitors).toBe(2);   // both first-seen this day
        // returning = visitors - newVisitors
        expect(o.totals.visitors - o.totals.newVisitors).toBe(0);
    });

    it('scopes by site + day range', async () => {
        expect((await repo.getOverview('other', '2026-07-01', '2026-07-31')).totals.pageviews).toBe(0);
        expect((await repo.getOverview('site_1', '2026-08-01', '2026-08-31')).totals.pageviews).toBe(0);
    });
});
