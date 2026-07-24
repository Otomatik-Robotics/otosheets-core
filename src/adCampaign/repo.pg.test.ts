import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { AdCampaignPgRepo } from './repo.pg';
import { utmCampaignFor, type AdCampaign } from './schema';

let db: PgDb;
let repo: AdCampaignPgRepo;
let pglite: PGlite;

const campaign = (over: Partial<AdCampaign> = {}): AdCampaign => ({
    campaignId: 'c1', orgId: 'org_1', createdBy: 'user_1',
    name: 'Winter gutter special', objective: 'leads', status: 'draft',
    channels: ['meta', 'google'],
    destination: { type: 'page', url: 'https://smith.otosheets.site/gutters', siteHost: 'smith.otosheets.site', path: '/gutters' },
    budget: { dailyCents: 2500, currency: 'AUD' },
    utmCampaign: utmCampaignFor('c1'),
    createdAt: '2026-07-20T01:00:00.000Z', updatedAt: '2026-07-20T01:00:00.000Z',
    ...over,
});

beforeAll(async () => {
    pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    await pglite.query("INSERT INTO orgs (org_id, name) VALUES ('org_1', 'Acme')");
    repo = new AdCampaignPgRepo(db);
});

describe('AdCampaignPgRepo', () => {
    it('createConditional is retry-safe (client-minted id)', async () => {
        expect(await repo.createConditional(campaign())).toBe(true);
        expect(await repo.createConditional(campaign())).toBe(false); // POST retry
        const got = await repo.get('org_1', 'c1');
        expect(got?.name).toBe('Winter gutter special');
        expect(got?.utmCampaign).toBe('oto_c1');
    });

    it('update patches only allow-listed fields, never status', async () => {
        expect(await repo.update('org_1', 'c1', {
            name: 'Winter gutters v2',
            status: 'active',              // must be ignored — transitions only
            campaignId: 'evil',            // not settable
            creative: { headline: 'Gutters cleaned this week' },
        })).toBe(true);
        const got = await repo.get('org_1', 'c1');
        expect(got?.name).toBe('Winter gutters v2');
        expect(got?.status).toBe('draft');
        expect(got?.campaignId).toBe('c1');
        expect(got?.creative?.headline).toBe('Gutters cleaned this week');
    });

    it('transitionStatus is single-flight (launch double-click safety)', async () => {
        expect(await repo.transitionStatus('org_1', 'c1', ['draft', 'error'], 'launching')).toBe(true);
        expect(await repo.transitionStatus('org_1', 'c1', ['draft', 'error'], 'launching')).toBe(false); // second click loses
        expect(await repo.transitionStatus('org_1', 'c1', ['launching'], 'active')).toBe(true);
    });

    it('mergePlatformRef merges channels without clobbering the other side', async () => {
        await repo.mergePlatformRef('org_1', 'c1', 'meta', { campaignId: 'm_123', status: 'ACTIVE' });
        await repo.mergePlatformRef('org_1', 'c1', 'google', { campaignId: 'g_456', status: 'ENABLED' });
        const got = await repo.get('org_1', 'c1');
        expect(got?.platform?.meta?.campaignId).toBe('m_123');
        expect(got?.platform?.google?.campaignId).toBe('g_456');
    });

    it('lists newest-first with keyset pagination', async () => {
        await repo.createConditional(campaign({
            campaignId: 'c2', name: 'Emergency call-outs', channels: ['meta'],
            utmCampaign: utmCampaignFor('c2'),
            createdAt: '2026-07-21T01:00:00.000Z', updatedAt: '2026-07-21T01:00:00.000Z',
        }));
        const page1 = await repo.listByOrg('org_1', { limit: 1 });
        expect(page1.items[0]?.campaignId).toBe('c2');
        expect(page1.lastEvaluatedKey).toBeTruthy();
        const page2 = await repo.listByOrg('org_1', { limit: 1, exclusiveStartKey: page1.lastEvaluatedKey });
        expect(page2.items[0]?.campaignId).toBe('c1');
    });

    it('joins leads by attribution utmCampaign for the funnel', async () => {
        const mk = (id: string, utm: string | null, stage: string, quoted?: number) =>
            pglite.query(
                `INSERT INTO leads (lead_id, org_id, owner_id, created_by, source, client_name, stage, quoted_amount, attribution, created_at, updated_at)
                 VALUES ($1, 'org_1', 'user_1', 'user_1', 'intake_form', 'Test', $2, $3, $4, '2026-07-21T02:00:00Z', '2026-07-21T02:00:00Z')`,
                [id, stage, quoted ?? null, utm ? JSON.stringify({ utmCampaign: utm, channel: 'meta' }) : null],
            );
        await mk('l1', 'oto_c1', 'NEW');
        await mk('l2', 'oto_c1', 'QUOTED');
        await mk('l3', 'oto_c1', 'Won', 1200);
        await mk('l6', 'oto_c1', 'COMPLETE', 800); // default pipeline's terminal stage counts as won
        await mk('l4', 'oto_c2', 'NEW');
        await mk('l5', null, 'NEW'); // organic — no attribution

        const stats = await repo.leadStatsByCampaign('org_1', ['oto_c1', 'oto_c2'], '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z');
        const c1 = stats.find(s => s.utmCampaign === 'oto_c1');
        expect(c1).toMatchObject({ leads: 4, qualified: 3, won: 2, wonValue: 2000 });
        expect(stats.find(s => s.utmCampaign === 'oto_c2')).toMatchObject({ leads: 1, qualified: 0, won: 0 });

        const split = await repo.leadSourceSplit('org_1', '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z');
        expect(split.find(r => r.channel === 'meta')?.leads).toBe(5);
        expect(split.find(r => r.channel === 'intake_form')?.leads).toBe(1); // falls back to lead.source
    });

    it('counts campaign-tagged pageviews from analytics_events', async () => {
        const ev = (id: string, utm: string | null, sid: string) =>
            pglite.query(
                `INSERT INTO analytics_events (site_id, event_id, day, ts, type, sid, utm_campaign)
                 VALUES ('smith.otosheets.site', $1, '2026-07-21', '2026-07-21T03:00:00Z', 'pageview', $2, $3)`,
                [id, sid, utm],
            );
        await ev('e1', 'oto_c1', 's1');
        await ev('e2', 'oto_c1', 's1');
        await ev('e3', 'oto_c1', 's2');
        await ev('e4', null, 's3');

        const visits = await repo.visitStatsByCampaign(
            ['smith.otosheets.site'], ['oto_c1', 'oto_c2'], '2026-07-01', '2026-07-31',
        );
        expect(visits).toHaveLength(1);
        expect(visits[0]).toMatchObject({ utmCampaign: 'oto_c1', visits: 3, sessions: 2 });
    });
});
