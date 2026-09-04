import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { leads, pipelines } from '../pg/schema/leadsPipelines';
import { LeadReportingPgRepo } from './repo.pg';

let db: PgDb;
let repo: LeadReportingPgRepo;

const D = (s: string) => new Date(s);
/** `n` whole days before now, so the fixtures do not drift with the clock. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/** A lead, optionally with a stage-history entry pinning when it last moved. */
function lead(over: Record<string, any>) {
    const { movedDaysAgo, ...rest } = over;
    return {
        orgId: 'org_1',
        ownerId: 'u_1',
        createdBy: 'u_1',
        source: 'manual',
        stage: 'NEW',
        createdAt: D('2026-01-01T00:00:00Z'),
        updatedAt: D('2026-01-01T00:00:00Z'),
        ...(movedDaysAgo === undefined
            ? {}
            : { stageHistory: [{ id: 'x', stage: rest.stage ?? 'NEW', changedBy: 'u_1', changedAt: daysAgo(movedDaysAgo) }] }),
        ...rest,
    } as any;
}

beforeAll(async () => {
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    await pglite.query("INSERT INTO orgs (org_id, name) VALUES ('org_1', 'Acme'), ('org_2', 'Other')");
    repo = new LeadReportingPgRepo(db);

    // pipeline_id carries a real FK, so the boards have to exist first.
    await db.insert(pipelines).values([
        { pipelineId: 'sales', orgId: 'org_1', createdBy: 'u_1', name: 'Sales', isDefault: false },
        { pipelineId: 'inbox', orgId: 'org_1', createdBy: 'u_1', name: 'Inbox', isDefault: true },
        { pipelineId: 'sales_2', orgId: 'org_2', createdBy: 'u_1', name: 'Sales', isDefault: true },
    ]);

    await db.insert(leads).values([
        // Two NEW on the sales board, one on inbox, one with no pipeline at all.
        lead({ leadId: 'l1', pipelineId: 'sales', stage: 'NEW', movedDaysAgo: 30 }),
        lead({ leadId: 'l2', pipelineId: 'sales', stage: 'NEW', movedDaysAgo: 2 }),
        lead({ leadId: 'l3', pipelineId: 'inbox', stage: 'NEW', movedDaysAgo: 9 }),
        lead({ leadId: 'l4', pipelineId: null, stage: 'NEW', movedDaysAgo: 12 }),
        // Not NEW, so it must not reach countByPipeline('NEW')…
        lead({ leadId: 'l5', pipelineId: 'sales', stage: 'QUOTED', movedDaysAgo: 40 }),
        // …but it IS stale. Terminal stages are not.
        lead({ leadId: 'l6', pipelineId: 'sales', stage: 'COMPLETE', movedDaysAgo: 90 }),
        lead({ leadId: 'l7', pipelineId: 'sales', stage: 'LOST', movedDaysAgo: 90 }),
        // No stage history at all: falls back to created_at, which is ancient.
        lead({ leadId: 'l8', pipelineId: 'inbox', stage: 'CONTACTED', stageHistory: null }),
        // Another org must never leak in.
        lead({ leadId: 'x1', orgId: 'org_2', pipelineId: 'sales_2', stage: 'NEW', movedDaysAgo: 50 }),
    ]);
});

describe('countByPipeline', () => {
    it('groups one stage by pipeline without a second query per board', async () => {
        const rows = await repo.countByPipeline('org_1', 'NEW');
        const by = Object.fromEntries(rows.map(r => [r.pipelineId ?? 'none', r.count]));
        expect(by).toEqual({ sales: 2, inbox: 1, none: 1 });
    });

    it('keeps leads with no pipeline under a null key for the caller to fold in', async () => {
        const rows = await repo.countByPipeline('org_1', 'NEW');
        expect(rows.find(r => r.pipelineId === null)?.count).toBe(1);
    });

    it('counts only the stage asked for', async () => {
        const rows = await repo.countByPipeline('org_1', 'QUOTED');
        expect(rows).toEqual([{ pipelineId: 'sales', count: 1 }]);
    });

    it('never leaks another org', async () => {
        const rows = await repo.countByPipeline('org_2', 'NEW');
        expect(rows).toEqual([{ pipelineId: 'sales_2', count: 1 }]);
    });
});

describe('listStale', () => {
    it('finds leads that have not moved in the window, longest-sitting first', async () => {
        const stale = await repo.listStale('org_1', 7);
        // l8 has no history so it falls back to its 2026 created_at, the oldest.
        expect(stale.map(s => s.lead.leadId)).toEqual(['l8', 'l5', 'l1', 'l4', 'l3']);
    });

    it('states an exact whole-day count, not a bucket', async () => {
        const stale = await repo.listStale('org_1', 7);
        const byId = Object.fromEntries(stale.map(s => [s.lead.leadId, s.days]));
        expect(byId.l3).toBe(9);
        expect(byId.l4).toBe(12);
        expect(byId.l1).toBe(30);
    });

    it('leaves a lead inside the window alone', async () => {
        const stale = await repo.listStale('org_1', 7);
        expect(stale.map(s => s.lead.leadId)).not.toContain('l2');
    });

    it('ignores terminal stages — parked in COMPLETE or LOST is finished, not neglected', async () => {
        const stale = await repo.listStale('org_1', 7);
        const ids = stale.map(s => s.lead.leadId);
        expect(ids).not.toContain('l6');
        expect(ids).not.toContain('l7');
    });

    it('measures the last stage move, not the last edit', async () => {
        // l1 moved 30 days ago. Touching the row must not make it look fresh —
        // that is exactly the bug in the shipped "going cold" card.
        await db.update(leads).set({ updatedAt: new Date(), clientName: 'edited just now' })
            .where(eq(leads.leadId, 'l1'));
        const stale = await repo.listStale('org_1', 7);
        expect(stale.find(s => s.lead.leadId === 'l1')?.days).toBe(30);
    });

    it('honours the window it is given', async () => {
        const stale = await repo.listStale('org_1', 29);
        expect(stale.map(s => s.lead.leadId)).toEqual(['l8', 'l5', 'l1']);
    });

    it('never leaks another org', async () => {
        const stale = await repo.listStale('org_2', 7);
        expect(stale.map(s => s.lead.leadId)).toEqual(['x1']);
    });
});
