import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { ReceiptPgRepo } from './repo.pg';

let db: PgDb;
let repo: ReceiptPgRepo;
let pglite: PGlite;

const ORG = 'org_1';

beforeAll(async () => {
    pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    await pglite.query(`INSERT INTO orgs (org_id, name) VALUES ('${ORG}', 'Acme'), ('org_2', 'Other')`);
    repo = new ReceiptPgRepo(db);
    await repo.createReceipt(ORG, 'u1', 'r_1', { status: 'PROCESSED', vendorName: 'JB Hi-Fi', totalAmount: 3200, taxAmount: 290.91, category: 'EQUIPMENT', date: '2026-08-10', aiRiskLevel: 'HIGH' });
    await repo.createReceipt(ORG, 'u1', 'r_2', { status: 'PROCESSED', vendorName: 'Bunnings', totalAmount: 89.1, category: 'TOOLS', date: '2026-08-11' });
});

describe('ReceiptPgRepo review signals', () => {
    it('markOpened stamps once; a re-open is a no-op', async () => {
        expect(await repo.markOpened(ORG, 'r_1', 'u1')).toBe(true);
        expect(await repo.markOpened(ORG, 'r_1', 'u2')).toBe(false);
        expect(await repo.markOpened(ORG, 'nope', 'u1')).toBe(false);
        expect(await repo.markOpened('org_2', 'r_1', 'u1')).toBe(false); // org-scoped
        const got = await repo.getReceipt(ORG, 'u1', 'r_1');
        expect(got?.openedBy).toBe('u1');
        expect(typeof got?.openedAt).toBe('string');
    });

    it('confirmCategory sets the category and acknowledges the risk flag, but keeps an earlier acknowledgement', async () => {
        expect(await repo.confirmCategory(ORG, 'r_1', { category: 'COMPUTER', userId: 'u1' })).toBe(true);
        let got = await repo.getReceipt(ORG, 'u1', 'r_1');
        expect(got?.category).toBe('COMPUTER');
        expect(got?.categoryConfirmedBy).toBe('u1');
        expect(typeof got?.categoryConfirmedAt).toBe('string');
        expect(got?.reviewedBy).toBe('u1');
        const firstReviewedAt = got?.reviewedAt;
        expect(typeof firstReviewedAt).toBe('string');

        // Re-confirming with a different category is a legitimate update; the original acknowledgement stands.
        expect(await repo.confirmCategory(ORG, 'r_1', { category: 'EQUIPMENT', userId: 'u2' })).toBe(true);
        got = await repo.getReceipt(ORG, 'u1', 'r_1');
        expect(got?.category).toBe('EQUIPMENT');
        expect(got?.categoryConfirmedBy).toBe('u2');
        expect(got?.reviewedAt).toBe(firstReviewedAt);
        expect(got?.reviewedBy).toBe('u1');

        expect(await repo.confirmCategory(ORG, 'nope', { category: 'X', userId: 'u1' })).toBe(false);
    });

    it('linkAsset is conditional on no other asset; declineAssetOffer refuses once linked', async () => {
        expect(await repo.linkAsset(ORG, 'r_1', 'a_1')).toBe(true);
        expect(await repo.linkAsset(ORG, 'r_1', 'a_1')).toBe(true);   // replay with the same asset
        expect(await repo.linkAsset(ORG, 'r_1', 'a_2')).toBe(false);  // never silently repoint
        expect(await repo.linkAsset(ORG, 'nope', 'a_1')).toBe(false);
        expect((await repo.getReceipt(ORG, 'u1', 'r_1'))?.assetId).toBe('a_1');
        expect(await repo.declineAssetOffer(ORG, 'r_1')).toBe(false); // already promoted
    });

    it('declineAssetOffer stamps once and blocks a later link', async () => {
        expect(await repo.declineAssetOffer(ORG, 'r_2')).toBe(true);
        expect(await repo.declineAssetOffer(ORG, 'r_2')).toBe(false);
        expect(typeof (await repo.getReceipt(ORG, 'u1', 'r_2'))?.assetDeclinedAt).toBe('string');
        // A declined receipt can still be promoted explicitly — declining only removes the offer.
        expect(await repo.linkAsset(ORG, 'r_2', 'a_9')).toBe(true);
    });

    it('the mirror path round-trips the new timestamps as ISO strings', async () => {
        const got = (await repo.getReceipt(ORG, 'u1', 'r_1'))!;
        await repo.upsertReceipt({ ...got, vendorName: 'JB Hi-Fi Perth' });
        const again = await repo.getReceipt(ORG, 'u1', 'r_1');
        expect(again?.vendorName).toBe('JB Hi-Fi Perth');
        expect(again?.openedAt).toBe(got.openedAt);
        expect(again?.categoryConfirmedAt).toBe(got.categoryConfirmedAt);
        expect(again?.assetId).toBe('a_1');
    });
});

describe('ReceiptPgRepo.listAssetCandidates', () => {
    beforeAll(async () => {
        // r_1 promoted, r_2 declined-then-linked: neither is a candidate any more.
        const mk = (id: string, over: Record<string, any>) => repo.createReceipt(ORG, 'u1', id, { status: 'PROCESSED', totalAmount: 500, date: '2026-08-12', ...over });
        await mk('c_a', { category: 'equipment', vendorName: 'Officeworks' });
        await mk('c_b', { category: 'TOOLS', vendorName: 'Sydney Tools' });
        await mk('c_c', { category: 'VEHICLE', vendorName: 'Toyota' });
        await mk('c_meals', { category: 'MEALS', vendorName: 'Cafe' });          // wrong category
        await mk('c_dup', { category: 'TOOLS', status: 'DUPLICATE' });           // duplicate
        await mk('c_arch', { category: 'TOOLS', status: 'ARCHIVED' });           // archived
        await repo.createReceipt('org_2', 'u9', 'c_other', { status: 'PROCESSED', category: 'TOOLS', totalAmount: 5 }); // other org
    });

    it('returns only unpromoted, undeclined receipts in the given categories, newest upload first', async () => {
        const page = await repo.listAssetCandidates({ orgId: ORG, categories: ['Equipment', 'tools', 'VEHICLE'] });
        expect(page.items.map((r) => r.receiptId)).toEqual(['c_c', 'c_b', 'c_a']);
        expect(page.lastEvaluatedKey).toBeUndefined();
        expect((await repo.listAssetCandidates({ orgId: ORG, categories: [] })).items).toEqual([]);
        expect((await repo.listAssetCandidates({ orgId: ORG, categories: ['MEALS'] })).items.map((r) => r.receiptId)).toEqual(['c_meals']);
    });

    it('pages on a keyset cursor', async () => {
        const p1 = await repo.listAssetCandidates({ orgId: ORG, categories: ['EQUIPMENT', 'TOOLS', 'VEHICLE'], limit: 2 });
        expect(p1.items.map((r) => r.receiptId)).toEqual(['c_c', 'c_b']);
        expect(p1.lastEvaluatedKey).toBeDefined();
        const p2 = await repo.listAssetCandidates({ orgId: ORG, categories: ['EQUIPMENT', 'TOOLS', 'VEHICLE'], limit: 2, exclusiveStartKey: p1.lastEvaluatedKey });
        expect(p2.items.map((r) => r.receiptId)).toEqual(['c_a']);
        expect(p2.lastEvaluatedKey).toBeUndefined();
    });

    it('drops a receipt the moment it is promoted or declined', async () => {
        await repo.linkAsset(ORG, 'c_c', 'a_car');
        await repo.declineAssetOffer(ORG, 'c_b');
        const page = await repo.listAssetCandidates({ orgId: ORG, categories: ['EQUIPMENT', 'TOOLS', 'VEHICLE'] });
        expect(page.items.map((r) => r.receiptId)).toEqual(['c_a']);
    });
});

describe('ReceiptPgRepo.countAssetCandidates', () => {
    it('counts the whole backlog, not a page of it', async () => {
        // The register shows this as the number of receipts still to deal with.
        // Counting a page caps the figure at the page size and stops moving as
        // more arrive, so the count has to come from the query. Own org, so the
        // earlier cases in this file cannot promote the fixture out from under it.
        const org = 'org_backlog';
        await pglite.query(`INSERT INTO orgs (org_id, name) VALUES ('${org}', 'Backlog') ON CONFLICT DO NOTHING`);
        for (let i = 0; i < 5; i++) {
            await repo.createReceipt(org, 'u1', `b_${i}`, { status: 'PROCESSED', totalAmount: 500, date: '2026-08-12', category: 'TOOLS' });
        }
        const cats = ['TOOLS'];

        const page = await repo.listAssetCandidates({ orgId: org, categories: cats, limit: 2 });
        const total = await repo.countAssetCandidates(org, cats);

        expect(page.items).toHaveLength(2);
        expect(total).toBe(5);
    });

    it('is case insensitive and answers zero for no categories', async () => {
        expect(await repo.countAssetCandidates(ORG, ['equipment'])).toBe(
            await repo.countAssetCandidates(ORG, ['EQUIPMENT']),
        );
        expect(await repo.countAssetCandidates(ORG, [])).toBe(0);
    });

    it('is scoped to the organisation', async () => {
        expect(await repo.countAssetCandidates('org_2', ['EQUIPMENT', 'VEHICLE'])).toBe(0);
    });
});
