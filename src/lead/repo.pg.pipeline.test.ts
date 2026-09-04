import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { leads, pipelines } from '../pg/schema/leadsPipelines';
import { LeadPgRepo } from './repo.pg';

/**
 * The pipeline filter has to run in the query.
 *
 * It used to run over the returned page, which meant a board could show an
 * empty page while later pages held its leads, and no count derived from this
 * endpoint could be trusted. These fixtures make that failure reproducible: the
 * target pipeline's leads are the OLDEST rows, so with a small page they fall
 * outside the first page entirely under the old behaviour.
 */
let db: PgDb;
let repo: LeadPgRepo;

const D = (s: string) => new Date(s);

beforeAll(async () => {
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    await pglite.query("INSERT INTO orgs (org_id, name) VALUES ('org_1', 'Acme')");
    repo = new LeadPgRepo(db);

    await db.insert(pipelines).values([
        { pipelineId: 'sales', orgId: 'org_1', createdBy: 'u_1', name: 'Sales', isDefault: false },
        { pipelineId: 'inbox', orgId: 'org_1', createdBy: 'u_1', name: 'Inbox', isDefault: true },
    ]);

    const rows: any[] = [];
    // 25 recent leads on `inbox` — more than one page.
    for (let i = 0; i < 25; i++) {
        rows.push({
            leadId: `inbox_${i}`, orgId: 'org_1', ownerId: 'u_1', createdBy: 'u_1',
            source: 'manual', stage: 'NEW', pipelineId: 'inbox',
            createdAt: D(`2026-03-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
            updatedAt: D('2026-03-01T00:00:00Z'),
        });
    }
    // Two OLD leads on `sales`, so they sit past the first page of a desc list.
    rows.push({ leadId: 'sales_a', orgId: 'org_1', ownerId: 'u_1', createdBy: 'u_1', source: 'manual', stage: 'NEW', pipelineId: 'sales', createdAt: D('2026-01-02T00:00:00Z'), updatedAt: D('2026-01-02T00:00:00Z') });
    rows.push({ leadId: 'sales_b', orgId: 'org_1', ownerId: 'u_1', createdBy: 'u_1', source: 'manual', stage: 'NEW', pipelineId: 'sales', createdAt: D('2026-01-01T00:00:00Z'), updatedAt: D('2026-01-01T00:00:00Z') });
    // Unassigned, claimable by a source rule.
    rows.push({ leadId: 'unassigned_web', orgId: 'org_1', ownerId: 'u_1', createdBy: 'u_1', source: 'website_agent', stage: 'NEW', pipelineId: null, channelId: 'site_1', createdAt: D('2026-01-03T00:00:00Z'), updatedAt: D('2026-01-03T00:00:00Z') });
    rows.push({ leadId: 'unassigned_other', orgId: 'org_1', ownerId: 'u_1', createdBy: 'u_1', source: 'meta_instagram', stage: 'NEW', pipelineId: null, createdAt: D('2026-01-04T00:00:00Z'), updatedAt: D('2026-01-04T00:00:00Z') });
    await db.insert(leads).values(rows);
});

describe('listOrgLeadsPaginated — pipeline membership', () => {
    it('finds a board’s leads even when they fall past the first page', async () => {
        // The regression: with 25 newer leads on another board, a page of 20
        // filtered afterwards returns NOTHING for sales.
        const page = await repo.listOrgLeadsPaginated({ orgId: 'org_1', limit: 20, pipelineId: 'sales' });
        expect(page.items.map(l => l.leadId).sort()).toEqual(['sales_a', 'sales_b']);
    });

    it('fills the page from the matching set, not from whatever was fetched', async () => {
        const page = await repo.listOrgLeadsPaginated({ orgId: 'org_1', limit: 20, pipelineId: 'inbox' });
        expect(page.items).toHaveLength(20);
        expect(page.items.every(l => l.pipelineId === 'inbox')).toBe(true);
        expect(page.lastEvaluatedKey).toBeDefined();
    });

    it('leaves unassigned leads out unless something claims them', async () => {
        const page = await repo.listOrgLeadsPaginated({ orgId: 'org_1', limit: 50, pipelineId: 'sales' });
        expect(page.items.map(l => l.leadId)).not.toContain('unassigned_web');
    });

    it('includes unassigned leads on the default board when asked', async () => {
        const page = await repo.listOrgLeadsPaginated({ orgId: 'org_1', limit: 50, pipelineId: 'sales', includeUnassigned: true });
        const ids = page.items.map(l => l.leadId);
        expect(ids).toContain('unassigned_web');
        expect(ids).toContain('unassigned_other');
        expect(ids).not.toContain('inbox_0');
    });

    it('claims an unassigned lead by source rule', async () => {
        const page = await repo.listOrgLeadsPaginated({
            orgId: 'org_1', limit: 50, pipelineId: 'sales',
            pipelineSources: [{ sourceType: 'website_agent' }],
        });
        const ids = page.items.map(l => l.leadId);
        expect(ids).toContain('unassigned_web');
        expect(ids).not.toContain('unassigned_other');
    });

    it('respects a source rule pinned to one channel', async () => {
        const match = await repo.listOrgLeadsPaginated({
            orgId: 'org_1', limit: 50, pipelineId: 'sales',
            pipelineSources: [{ sourceType: 'website_agent', channelId: 'site_1' }],
        });
        expect(match.items.map(l => l.leadId)).toContain('unassigned_web');

        const miss = await repo.listOrgLeadsPaginated({
            orgId: 'org_1', limit: 50, pipelineId: 'sales',
            pipelineSources: [{ sourceType: 'website_agent', channelId: 'some_other_site' }],
        });
        expect(miss.items.map(l => l.leadId)).not.toContain('unassigned_web');
    });

    it('never claims a lead that already belongs to another board', async () => {
        const page = await repo.listOrgLeadsPaginated({
            orgId: 'org_1', limit: 50, pipelineId: 'sales',
            includeUnassigned: true,
            pipelineSources: [{ sourceType: 'manual' }],
        });
        expect(page.items.map(l => l.leadId)).not.toContain('inbox_0');
    });

    it('is a no-op without a pipelineId', async () => {
        const page = await repo.listOrgLeadsPaginated({ orgId: 'org_1', limit: 50 });
        expect(page.items).toHaveLength(29);
    });
});
