import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from './migrate';
import type { PgDb } from './client';
import { PipelinePgRepo } from '../pipeline/repo.pg';
import { LeadPgRepo } from '../lead/repo.pg';
import { BookingPgRepo } from '../booking/repo.pg';

let db: PgDb;
beforeAll(async () => {
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    await pglite.query("INSERT INTO orgs (org_id, name) VALUES ('org_1', 'Acme')");
});

describe('PipelinePgRepo', () => {
    it('CRUD + default + jsonb arrays', async () => {
        const r = new PipelinePgRepo(db);
        await r.createPipeline('org_1', 'p_1', { name: 'Sales', createdBy: 'u1', stages: ['NEW', 'WON'], isDefault: true, voiceConfig: { enabled: true } });
        const p = await r.getPipeline('org_1', 'p_1');
        expect(p).toMatchObject({ pipelineId: 'p_1', name: 'Sales', isDefault: true });
        expect(p!.stages).toEqual(['NEW', 'WON']);
        expect((await r.getDefaultPipeline('org_1'))?.pipelineId).toBe('p_1');
        expect(await r.scanAllPipelines()).toHaveLength(1);
    });
});

describe('LeadPgRepo', () => {
    const r = () => new LeadPgRepo(db);
    it('create sets stage/orgStage/stageHistory/sk; stage + sender queries', async () => {
        await r().createLead('org_1', 'u1', 'l_1', { source: 'META', clientName: 'Bob Jones', senderId: 's99', stage: 'NEW' });
        const l = await r().getLead('org_1', 'u1', 'l_1');
        expect(l).toMatchObject({ leadId: 'l_1', source: 'META', stage: 'NEW' });
        expect(l!.sk).toBe('u1#l_1');
        expect((l as any).orgStage).toBe('org_1#NEW');
        expect(l!.stageHistory).toEqual([expect.objectContaining({ stage: 'NEW', changedBy: 'u1' })]);
        expect((await r().listLeadsByStage('org_1', 'NEW')).map(x => x.leadId)).toEqual(['l_1']);
        expect((await r().findActiveLeadBySenderId('org_1', 's99'))?.leadId).toBe('l_1');

        await r().updateLead('org_1', 'u1', 'l_1', { stage: 'WON' });
        expect((await r().getLead('org_1', 'u1', 'l_1') as any).orgStage).toBe('org_1#WON');
        expect(await r().findActiveLeadBySenderId('org_1', 's99')).not.toBeNull(); // WON is not terminal

        const search = await r().listOrgLeadsPaginated({ orgId: 'org_1', search: 'bob' });
        expect(search.items.map(x => x.leadId)).toEqual(['l_1']);
    });
    it('upsert accepts a Dynamo DTO with string timestamps + sk', async () => {
        await r().upsertLead({ leadId: 'l_mir', orgId: 'org_1', sk: 'u2#l_mir', createdBy: 'u2', source: 'WEB', stage: 'NEW', stageHistory: [], createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z' } as any);
        const l = await r().getLead('org_1', 'u2', 'l_mir');
        expect(l!.sk).toBe('u2#l_mir');
        expect(l!.createdAt).toBe('2026-07-01T00:00:00.000Z');
    });
});

describe('BookingPgRepo', () => {
    const r = () => new BookingPgRepo(db);
    it('create reconstructs sk/dateSk; date-range query', async () => {
        await r().createBooking('org_1', 'u1', 'b_1', { date: '2026-07-10', startTime: '09:00', endTime: '10:00', clientName: 'Sue', status: 'CONFIRMED', source: 'WEB' });
        const b = await r().getBooking('org_1', 'u1', 'b_1');
        expect(b!.sk).toBe('u1#b_1');
        expect((b as any).dateSk).toBe('2026-07-10#b_1');
        expect((await r().listBookingsByDate('org_1', '2026-07-01', '2026-07-31')).map(x => x.bookingId)).toContain('b_1');
    });
});
