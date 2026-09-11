import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { ReceiptPgRepo } from './repo.pg';
let root: ReceiptPgRepo;
let a: ReceiptPgRepo;
beforeAll(async () => {
    const pg = new PGlite({ extensions: { pg_trgm } });
    await runMigrations({ exec: async s => ({ rows: (await pg.query(s)).rows as any[] }) });
    await pg.query("INSERT INTO orgs (org_id, name) VALUES ('org', 'Org'), ('foreign', 'Foreign')");
    root = new ReceiptPgRepo(drizzle(pg) as unknown as PgDb);
    a = root.withScope('org', 'a');
    for (const [id, profile] of [['a1', 'a'], ['a2', 'a'], ['b1', 'b'], ['legacy', undefined]] as const) {
        await root.createReceipt('org', 'user', id, { businessProfileId: profile, date: '2026-09-01', status: 'PROCESSED', totalAmount: 10, contentHash: 'same', vendorName: 'Vendor', duplicateOf: 'source' });
    }
});
describe('profile-bound receipt SQL', () => {
    it('scopes lists, totals, pagination and indirect duplicate queries', async () => {
        expect((await a.listAllOrgReceipts('org')).map(r => r.receiptId).sort()).toEqual(['a1', 'a2']);
        expect((await a.listReceiptsByDate('org', '2026-01-01', '2026-12-31')).length).toBe(2);
        const page = await a.listReceiptsPaginated({ orgId: 'org', limit: 1 });
        expect(page.total).toBe(2);
        const next = await a.listReceiptsPaginated({ orgId: 'org', limit: 1, exclusiveStartKey: page.lastEvaluatedKey });
        expect(next.items[0].receiptId).not.toBe(page.items[0].receiptId);
        expect((await a.findReceiptsByDuplicateOf('org', 'source')).length).toBe(2);
        expect((await a.findReceiptsByVendorAndAmount('org', 'Vendor', 10)).length).toBe(2);
        expect((await a.findReceiptByContentHash('org', 'same'))?.businessProfileId).toBe('a');
    });
    it('foreign and unassigned records cannot be read or mutated', async () => {
        for (const id of ['b1', 'legacy']) {
            expect(await a.getReceipt('org', 'user', id)).toBeNull();
            await a.updateReceipt('org', 'user', id, { totalAmount: 999 });
            expect(await a.markOpened('org', id, 'user')).toBe(false);
            expect(await a.confirmCategory('org', id, { category: 'OTHER', userId: 'user' })).toBe(false);
            await a.deleteReceipt('org', 'user', id);
            expect((await root.getReceipt('org', 'user', id))?.totalAmount).toBe(10);
        }
    });
    it('creates in the bound scope and prevents tenant reassignment', async () => {
        await a.createReceipt('org', 'user', 'new', { totalAmount: 1 });
        expect((await a.getReceipt('org', 'user', 'new'))?.businessProfileId).toBe('a');
        await expect(a.updateReceipt('org', 'user', 'new', { businessProfileId: 'b' })).rejects.toThrow('profile mismatch');
        await expect(a.getReceipt('foreign', 'user', 'new')).rejects.toThrow('organisation mismatch');
        expect(() => a.withScope('org', 'b')).toThrow('cannot change');
        expect(() => root.withScope('org', '')).toThrow('required');
    });
});
