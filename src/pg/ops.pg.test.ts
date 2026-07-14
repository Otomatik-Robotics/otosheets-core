import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
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

    it('listReceiptsPaginated: date-desc order, keyset paging, total, filters', async () => {
        await (db as any).execute(sql`INSERT INTO orgs (org_id, name) VALUES ('org_rc', 'RC Co')`);
        const r = new ReceiptPgRepo(db);
        // r_1 above is DUPLICATE in org_1 — this suite uses an isolated org.
        await r.createReceipt('org_rc', 'u1', 'rc_a', { status: 'PROCESSED', totalAmount: 100, taxAmount: 9.09, category: 'FUEL', vendorName: 'Shell', description: 'unleaded', date: '2026-07-03', isDeductible: true, businessPercent: 100, aiRiskLevel: 'HIGH' });
        await r.createReceipt('org_rc', 'u1', 'rc_b', { status: 'PROCESSED', totalAmount: 50, taxAmount: 4.55, category: 'MEALS', vendorName: 'Cafe', description: 'lunch', date: '2026-07-05', isDeductible: true, businessAmount: 20, aiRiskLevel: 'LOW' });
        await r.createReceipt('org_rc', 'u1', 'rc_c', { status: 'PROCESSED', totalAmount: 30, category: 'FUEL', vendorName: 'BP', description: 'diesel', date: '2026-07-01', isDeductible: false, aiRiskLevel: 'MEDIUM' });
        await r.createReceipt('org_rc', 'u1', 'rc_arch', { status: 'ARCHIVED', totalAmount: 999, category: 'FUEL', vendorName: 'Shell', date: '2026-07-04' });
        await r.createReceipt('org_rc', 'u1', 'rc_nodate', { status: 'PROCESSED', totalAmount: 5, category: 'MISC', vendorName: 'Kiosk' });

        // Full list: newest date first; ARCHIVED + undated excluded; total = 3.
        const all = await r.listReceiptsPaginated({ orgId: 'org_rc' });
        expect(all.items.map(i => i.receiptId)).toEqual(['rc_b', 'rc_a', 'rc_c']);
        expect(all.total).toBe(3);
        expect(all.lastEvaluatedKey).toBeUndefined();

        // Keyset pagination across two pages of 2 + 1.
        const p1 = await r.listReceiptsPaginated({ orgId: 'org_rc', limit: 2 });
        expect(p1.items.map(i => i.receiptId)).toEqual(['rc_b', 'rc_a']);
        expect(p1.total).toBe(3);
        expect(p1.lastEvaluatedKey).toEqual({ date: '2026-07-03', id: 'rc_a' });
        const p2 = await r.listReceiptsPaginated({ orgId: 'org_rc', limit: 2, exclusiveStartKey: p1.lastEvaluatedKey });
        expect(p2.items.map(i => i.receiptId)).toEqual(['rc_c']);
        expect(p2.lastEvaluatedKey).toBeUndefined();

        // Filters: category, case-insensitive search on vendor/description, date range.
        expect((await r.listReceiptsPaginated({ orgId: 'org_rc', category: 'FUEL' })).items.map(i => i.receiptId)).toEqual(['rc_a', 'rc_c']);
        expect((await r.listReceiptsPaginated({ orgId: 'org_rc', search: 'DIESEL' })).items.map(i => i.receiptId)).toEqual(['rc_c']);
        expect((await r.listReceiptsPaginated({ orgId: 'org_rc', dateFrom: '2026-07-02', dateTo: '2026-07-04' })).items.map(i => i.receiptId)).toEqual(['rc_a']);
    });

    it('summarizeReceipts: SQL totals, deductible fallback, high-risk, category breakdown', async () => {
        const r = new ReceiptPgRepo(db);
        const s = await r.summarizeReceipts({ orgId: 'org_rc' });
        expect(s.count).toBe(3);              // rc_a + rc_b + rc_c (ARCHIVED + undated excluded)
        expect(s.totalAmount).toBe(180);      // 100 + 50 + 30
        expect(s.totalGst).toBe(13.64);       // 9.09 + 4.55
        expect(s.deductibleAmount).toBe(120); // rc_a 100 (100%) + rc_b 20 (businessAmount)
        expect(s.highRiskCount).toBe(1);      // rc_a
        expect(s.categories).toEqual([
            { category: 'FUEL', amount: 130, count: 2 },
            { category: 'MEALS', amount: 50, count: 1 },
        ]);
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
