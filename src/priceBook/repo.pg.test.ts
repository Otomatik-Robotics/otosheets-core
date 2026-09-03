import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { PriceBookPgRepo } from './repo.pg';

/**
 * The price book endpoint used to return every row and let the page filter in
 * memory — which caps out at the payload limit and makes search miss anything
 * past it. These pin the replacement: paging and searching happen in Postgres.
 */

let db: PgDb;
let repo: PriceBookPgRepo;

const ORG = 'org_1';
const OTHER = 'org_2';
const D = (s: string) => new Date(s);

/** Deliberately inserted out of alphabetical order — the repo does the ordering. */
const SEED = [
    { itemId: 'i_solder', name: 'Solder 500g', description: 'Lead-free', unit: 'ea', unitPrice: '38.40', costPrice: '24.00', qtyOnHand: '22', supplierId: 's_reece' },
    { itemId: 'i_elbow', name: 'Copper elbow 15mm', description: 'Press fit', unit: 'ea', unitPrice: '6.90', costPrice: '2.10', qtyOnHand: '8', supplierId: 's_reece' },
    { itemId: 'i_labour', name: 'Labour standard hr', description: 'On site', unit: 'hr', unitPrice: '110.00', costPrice: null, qtyOnHand: null, supplierId: null },
    { itemId: 'i_tee', name: 'PVC tee 40mm', description: 'Solvent weld', unit: 'ea', unitPrice: '3.80', costPrice: '1.15', qtyOnHand: '146', supplierId: 's_tradelink' },
    { itemId: 'i_callout', name: 'Callout fee', description: 'First hour', unit: 'ea', unitPrice: '88.00', costPrice: null, qtyOnHand: null, supplierId: null },
    // Same name as another row: the keyset has to break the tie on itemId or
    // paging stalls forever on the duplicate.
    { itemId: 'i_elbow_b', name: 'Copper elbow 15mm', description: 'Solder ring', unit: 'ea', unitPrice: '5.40', costPrice: '1.80', qtyOnHand: '3', supplierId: 's_tradelink' },
];

beforeAll(async () => {
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    repo = new PriceBookPgRepo(db);

    await pglite.query(`INSERT INTO orgs (org_id, name) VALUES ('${ORG}', 'Acme'), ('${OTHER}', 'Other')`);
    for (const r of SEED) {
        await pglite.query(
            `INSERT INTO price_book_items (item_id, org_id, name, description, unit, unit_price, cost_price, qty_on_hand, supplier_id, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
            [r.itemId, ORG, r.name, r.description, r.unit, r.unitPrice, r.costPrice, r.qtyOnHand, r.supplierId, D('2026-01-01T00:00:00Z')],
        );
    }
    // A different org's row — must never appear in any result below.
    await pglite.query(
        `INSERT INTO price_book_items (item_id, org_id, name, unit_price, created_at, updated_at)
         VALUES ('i_foreign', $1, 'Copper elbow 15mm', '9.99', $2, $2)`,
        [OTHER, D('2026-01-01T00:00:00Z')],
    );
});

describe('PriceBookPgRepo.listPaginated', () => {
    it('orders by name — a price book is scanned, not scrolled like a feed', async () => {
        const page = await repo.listPaginated({ orgId: ORG, limit: 50 });
        expect(page.items.map((i) => i.name)).toEqual([
            'Callout fee',
            'Copper elbow 15mm',
            'Copper elbow 15mm',
            'Labour standard hr',
            'PVC tee 40mm',
            'Solder 500g',
        ]);
        expect(page.total).toBe(6);
        expect(page.lastEvaluatedKey).toBeNull();
    });

    it('scopes to the org', async () => {
        const page = await repo.listPaginated({ orgId: ORG, limit: 50 });
        expect(page.items.every((i) => i.orgId === ORG)).toBe(true);
        expect(page.items.map((i) => i.itemId)).not.toContain('i_foreign');
    });

    it('pages without skipping or repeating, even across duplicate names', async () => {
        const seen: string[] = [];
        let cursor: { name: string; id: string } | null = null;
        let guard = 0;
        do {
            const page = await repo.listPaginated({ orgId: ORG, limit: 2, exclusiveStartKey: cursor });
            seen.push(...page.items.map((i) => i.itemId));
            cursor = page.lastEvaluatedKey;
        } while (cursor && ++guard < 10);

        expect(guard).toBeLessThan(10);                      // terminated, did not stall
        expect(seen).toHaveLength(6);                        // nothing skipped
        expect(new Set(seen).size).toBe(6);                  // nothing repeated
    });

    it('reports the total over the full filtered set, not the page', async () => {
        const page = await repo.listPaginated({ orgId: ORG, limit: 2 });
        expect(page.items).toHaveLength(2);
        expect(page.total).toBe(6);
    });

    it('searches name, description and unit in Postgres', async () => {
        const byName = await repo.listPaginated({ orgId: ORG, search: 'elbow' });
        expect(byName.items.map((i) => i.itemId).sort()).toEqual(['i_elbow', 'i_elbow_b']);

        const byDescription = await repo.listPaginated({ orgId: ORG, search: 'solvent' });
        expect(byDescription.items.map((i) => i.itemId)).toEqual(['i_tee']);

        const byUnit = await repo.listPaginated({ orgId: ORG, search: 'hr' });
        expect(byUnit.items.map((i) => i.itemId)).toEqual(['i_labour']);
    });

    it('searches case-insensitively', async () => {
        const upper = await repo.listPaginated({ orgId: ORG, search: 'COPPER' });
        expect(upper.items).toHaveLength(2);
    });

    it('narrows the total to the search, so the UI count matches the list', async () => {
        const page = await repo.listPaginated({ orgId: ORG, search: 'elbow', limit: 1 });
        expect(page.items).toHaveLength(1);
        expect(page.total).toBe(2);
    });

    it('splits stocked items from services', async () => {
        const stocked = await repo.listPaginated({ orgId: ORG, kind: 'stocked' });
        expect(stocked.items.map((i) => i.itemId).sort())
            .toEqual(['i_elbow', 'i_elbow_b', 'i_solder', 'i_tee']);

        const services = await repo.listPaginated({ orgId: ORG, kind: 'services' });
        expect(services.items.map((i) => i.itemId).sort()).toEqual(['i_callout', 'i_labour']);
    });

    it('filters by supplier — the point of the 0036 column', async () => {
        const page = await repo.listPaginated({ orgId: ORG, supplierId: 's_tradelink' });
        expect(page.items.map((i) => i.itemId).sort()).toEqual(['i_elbow_b', 'i_tee']);
    });

    it('combines search with a filter', async () => {
        const page = await repo.listPaginated({ orgId: ORG, search: 'elbow', kind: 'stocked', supplierId: 's_reece' });
        expect(page.items.map((i) => i.itemId)).toEqual(['i_elbow']);
    });

    it('returns numbers, not numeric strings', async () => {
        const page = await repo.listPaginated({ orgId: ORG, search: 'Solder 500g' });
        const item = page.items[0];
        expect(item.unitPrice).toBe(38.4);
        expect(item.costPrice).toBe(24);
        expect(item.qtyOnHand).toBe(22);
    });

    it('caps limit so a caller cannot ask for the whole table', async () => {
        // The rule the endpoint exists to enforce: no request returns everything.
        const page = await repo.listPaginated({ orgId: ORG, limit: 100_000 });
        expect(page.items.length).toBeLessThanOrEqual(200);
    });
});
