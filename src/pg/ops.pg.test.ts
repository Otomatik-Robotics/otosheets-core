import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from './migrate';
import type { PgDb } from './client';
import { JobPgRepo } from '../job/repo.pg';
import { TimeEntryPgRepo } from '../timeEntry/repo.pg';
import { ReceiptPgRepo } from '../receipt/repo.pg';
import { TripPgRepo } from '../trip/repo.pg';
import { PriceBookPgRepo } from '../priceBook/repo.pg';

let db: PgDb;
beforeAll(async () => {
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const ex: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(ex);
    db = drizzle(pglite) as unknown as PgDb;
    await pglite.query("INSERT INTO orgs (org_id, name) VALUES ('org_1', 'Acme')");
});

describe('JobPgRepo', () => {
    it('create reconstructs sk/scheduledDateSk; status + date + member queries', async () => {
        const r = new JobPgRepo(db);
        await r.createJob('org_1', 'u1', 'j_1', { title: 'Fix tap', status: 'SCHEDULED', scheduledDate: '2026-07-10', assignedMembers: ['m1'], materials: [{ id: 'x', name: 'pipe' }] });
        const j = await r.getJob('org_1', 'u1', 'j_1');
        expect(j!.sk).toBe('u1#j_1');
        expect((j as any).scheduledDateSk).toBe('2026-07-10#j_1');
        expect(j!.assignedMembers).toEqual(['m1']);
        expect((await r.listOrgJobsPaginated({ orgId: 'org_1', memberId: 'm1' })).items.map(x => x.jobId)).toEqual(['j_1']);
        expect((await r.listJobsByDate('org_1', '2026-07-01', '2026-07-31')).length).toBe(1);
    });
});

describe('TimeEntryPgRepo', () => {
    it('uninvoiced filter + upsert with string timestamps', async () => {
        const r = new TimeEntryPgRepo(db);
        await r.createTimeEntry('org_1', 'u1', 't_1', { durationMinutes: 60, description: 'Work', billable: true });
        await r.upsertTimeEntry({ timeEntryId: 't_2', orgId: 'org_1', sk: 'u1#t_2', createdBy: 'u1', durationMinutes: 30, description: 'Billed', billable: true, invoicedAt: '2026-07-05T00:00:00.000Z', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z' } as any);
        const uninv = await r.listTimeEntries('org_1', 'u1', { uninvoiced: true });
        expect(uninv.map(x => x.timeEntryId)).toEqual(['t_1']);
    });
});

describe('ReceiptPgRepo', () => {
    it('content-hash dedupe ignores archived/duplicate + money round-trip', async () => {
        const r = new ReceiptPgRepo(db);
        await r.createReceipt('org_1', 'u1', 'r_1', { contentHash: 'h1', status: 'PROCESSED', totalAmount: 42.5, vendorName: 'Bunnings', date: '2026-07-01' });
        const f = await r.findReceiptByContentHash('org_1', 'h1');
        expect(f!.receiptId).toBe('r_1');
        expect(f!.totalAmount).toBe(42.5);
        expect(f!.sk).toBe('u1#r_1');
        await r.updateReceipt('org_1', 'u1', 'r_1', { status: 'DUPLICATE' });
        expect(await r.findReceiptByContentHash('org_1', 'h1')).toBeNull();
    });
});

describe('TripPgRepo', () => {
    it('create reconstructs sk/dateSk; distanceKm numeric', async () => {
        const r = new TripPgRepo(db);
        await r.createTrip('org_1', 'u1', 'tr_1', { date: '2026-07-02', distanceKm: 12.3, purpose: 'BUSINESS', startAddress: 'A St' });
        const t = await r.getTrip('org_1', 'u1', 'tr_1');
        expect(t!.sk).toBe('u1#tr_1');
        expect((t as any).dateSk).toBe('2026-07-02#tr_1');
        expect(t!.distanceKm).toBe(12.3);
        expect((await r.listOrgTripsPaginated({ orgId: 'org_1', search: 'a st' })).items.length).toBe(1);
    });
});

describe('PriceBookPgRepo', () => {
    it('put/get/list', async () => {
        const r = new PriceBookPgRepo(db);
        await r.putItem({ orgId: 'org_1', itemId: 'pb_1', name: 'Callout', description: 'fee', unitPrice: 90, unit: 'each', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z' } as any);
        const i = await r.getItem('org_1', 'pb_1');
        expect(i).toMatchObject({ itemId: 'pb_1', name: 'Callout', unitPrice: 90 });
        expect(await r.listItems('org_1')).toHaveLength(1);
    });
});
