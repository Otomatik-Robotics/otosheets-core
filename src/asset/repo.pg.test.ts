import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { AssetPgRepo } from './repo.pg';
import type { AssetDTO } from './schema';

let db: PgDb;
let repo: AssetPgRepo;
let pglite: PGlite;

const asset = (over: Partial<AssetDTO> = {}): AssetDTO => ({
    assetId: 'a1', orgId: 'org_1', ownerId: 'user_1', createdBy: 'user_1',
    name: 'Hilux', category: 'VEHICLE', isCar: false,
    priceIncGst: 48500, gstOnPrice: 4409.09, businessUsePercent: 80,
    purchaseDate: '2026-08-14', firstUsedDate: null, receiptId: null,
    status: 'ACTIVE', disposal: null, costAdditions: [], businessUseReviews: [],
    createdAt: '2026-08-14T01:00:00.000Z', updatedAt: '2026-08-14T01:00:00.000Z',
    ...over,
});

beforeAll(async () => {
    pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    await pglite.query("INSERT INTO orgs (org_id, name) VALUES ('org_1', 'Acme'), ('org_2', 'Other')");
    repo = new AssetPgRepo(db);
});

describe('AssetPgRepo', () => {
    it('createConditional is retry-safe and round-trips money as numbers', async () => {
        expect(await repo.createConditional(asset())).toBe('created');
        expect(await repo.createConditional(asset())).toBe('duplicate_id'); // POST retry
        const got = await repo.get('org_1', 'a1');
        expect(got).toMatchObject({
            assetId: 'a1', name: 'Hilux', category: 'VEHICLE', isCar: false,
            priceIncGst: 48500, gstOnPrice: 4409.09, businessUsePercent: 80,
            firstUsedDate: null, receiptId: null, status: 'ACTIVE', disposal: null,
            costAdditions: [], businessUseReviews: [],
            createdAt: '2026-08-14T01:00:00.000Z',
        });
        expect(await repo.get('org_2', 'a1')).toBeNull(); // org-scoped
    });

    it('promoting the same receipt twice yields one asset', async () => {
        expect(await repo.createConditional(asset({ assetId: 'a_r1', receiptId: 'r_1', name: 'MacBook', category: 'COMPUTER', priceIncGst: 3200, gstOnPrice: 290.91 }))).toBe('created');
        expect(await repo.createConditional(asset({ assetId: 'a_r1_again', receiptId: 'r_1', name: 'MacBook' }))).toBe('receipt_already_promoted');
        expect((await repo.getByReceipt('org_1', 'r_1'))?.assetId).toBe('a_r1');
        expect(await repo.getByReceipt('org_1', 'r_nope')).toBeNull();
        // Another org may promote its own receipt of the same id.
        expect(await repo.createConditional(asset({ assetId: 'a_other', orgId: 'org_2', receiptId: 'r_1' }))).toBe('created');
    });

    it('update patches only allow-listed fields and bumps updated_at', async () => {
        expect(await repo.update('org_1', 'a1', {
            name: 'Hilux SR5',
            firstUsedDate: '2026-08-20',
            businessUsePercent: 75,
            costAdditions: [{ date: '2026-09-01', amountIncGst: 1100, gstOnAmount: 100, description: 'Tow bar' }],
            status: 'DISPOSED',        // not settable
            assetId: 'evil',           // not settable
            orgId: 'org_2',            // not settable
        })).toBe(true);
        const got = await repo.get('org_1', 'a1');
        expect(got?.name).toBe('Hilux SR5');
        expect(got?.firstUsedDate).toBe('2026-08-20');
        expect(got?.businessUsePercent).toBe(75);
        expect(got?.costAdditions).toEqual([{ date: '2026-09-01', amountIncGst: 1100, gstOnAmount: 100, description: 'Tow bar' }]);
        expect(got?.status).toBe('ACTIVE');
        expect(got?.assetId).toBe('a1');
        expect(got?.updatedAt > got!.createdAt).toBe(true);
        expect(await repo.update('org_1', 'nope', { name: 'x' })).toBe(false);
    });

    it('counts active assets and those still missing a first-used date', async () => {
        expect(await repo.countActive('org_1')).toBe(2);          // a1 (has first use now) + a_r1
        expect(await repo.countWithoutFirstUse('org_1')).toBe(1); // a_r1
    });

    it('dispose flips to DISPOSED once; a retry cannot overwrite the first disposal', async () => {
        const first = { date: '2026-09-02', proceedsIncGst: 1650, gstOnSale: 150, kind: 'SOLD' as const };
        expect(await repo.dispose('org_1', 'a_r1', first)).toBe('disposed');
        expect(await repo.dispose('org_1', 'a_r1', { ...first, proceedsIncGst: 9999 })).toBe('already_disposed');
        expect(await repo.dispose('org_1', 'nope', first)).toBe('not_found');
        const got = await repo.get('org_1', 'a_r1');
        expect(got?.status).toBe('DISPOSED');
        expect(got?.disposal).toEqual(first);
        expect(await repo.countActive('org_1')).toBe(1);
        expect(await repo.countWithoutFirstUse('org_1')).toBe(0); // disposed assets drop out
    });

    it('listPaginated pages newest-first on a keyset cursor and filters by status', async () => {
        await repo.createConditional(asset({ assetId: 'a2', name: 'Drill', category: 'TOOLS', createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z' }));
        await repo.createConditional(asset({ assetId: 'a3', name: 'Desk', category: 'FURNITURE', createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z' })); // same instant → id tiebreak
        const p1 = await repo.listPaginated({ orgId: 'org_1', limit: 2 });
        expect(p1.items.map(a => a.assetId)).toEqual(['a3', 'a2']);
        expect(p1.lastEvaluatedKey).toBeDefined();
        const p2 = await repo.listPaginated({ orgId: 'org_1', limit: 2, exclusiveStartKey: p1.lastEvaluatedKey });
        expect(p2.items.map(a => a.assetId)).toEqual(['a_r1', 'a1']);
        expect(p2.lastEvaluatedKey).toBeDefined(); // page was full; the next page is empty
        const p3 = await repo.listPaginated({ orgId: 'org_1', limit: 2, exclusiveStartKey: p2.lastEvaluatedKey });
        expect(p3.items).toEqual([]);
        expect(p3.lastEvaluatedKey).toBeUndefined();

        expect((await repo.listPaginated({ orgId: 'org_1', status: 'DISPOSED' })).items.map(a => a.assetId)).toEqual(['a_r1']);
        expect((await repo.listPaginated({ orgId: 'org_2' })).items.map(a => a.assetId)).toEqual(['a_other']);
    });

    it('listAllForSchedule walks every page, disposed included', async () => {
        const all = await repo.listAllForSchedule('org_1');
        expect(all.map(a => a.assetId)).toEqual(['a3', 'a2', 'a_r1', 'a1']);
    });

    it('remove deletes within the org only', async () => {
        expect(await repo.remove('org_2', 'a3')).toBe(false);
        expect(await repo.remove('org_1', 'a3')).toBe(true);
        expect(await repo.get('org_1', 'a3')).toBeNull();
    });
});
