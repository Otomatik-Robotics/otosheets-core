import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { PriceBooksPgRepo, PriceBookNameTaken, PriceBookReorderMismatch } from './books.repo.pg';

/**
 * The standard/catalog distinction is MECHANICAL, and these are the tests that
 * hold it in place:
 *
 *   - membership: a missing entry in a CATALOG book means NOT IN IT. A missing
 *     entry in a STANDARD book is nothing at all — the price falls through.
 *   - fall-through: `resolvePrice` is a MONEY question and always falls through
 *     (entry → default book → item), because quoting must never fail to price
 *     an item just because nobody curated it into a list.
 *   - order: `position` only means anything for a catalog book, which is a
 *     display list; standard books are read alphabetically.
 *
 * Plus the two things a rollback depends on: the 0037 Standard seed is
 * idempotent, and nothing here ever writes stock.
 */

let pglite: PGlite;
let db: PgDb;
let repo: PriceBooksPgRepo;

const ORG = 'org_1';
const OTHER = 'org_2';
const STD = `pb_std_${ORG}`;
const D = (s: string) => new Date(s);

const SEED_ITEMS = [
    { itemId: 'i_solder', name: 'Solder 500g', description: 'Lead-free', unit: 'ea', unitPrice: '38.40', costPrice: '24.00', qtyOnHand: '22', supplierId: 's_reece' },
    { itemId: 'i_elbow', name: 'Copper elbow 15mm', description: 'Press fit', unit: 'ea', unitPrice: '6.90', costPrice: '2.10', qtyOnHand: '8', supplierId: 's_reece' },
    { itemId: 'i_labour', name: 'Labour standard hr', description: 'On site', unit: 'hr', unitPrice: '110.00', costPrice: null, qtyOnHand: null, supplierId: null },
    { itemId: 'i_tee', name: 'PVC tee 40mm', description: 'Solvent weld', unit: 'ea', unitPrice: '3.80', costPrice: '1.15', qtyOnHand: '146', supplierId: 's_tradelink' },
    { itemId: 'i_callout', name: 'Callout fee', description: 'First hour', unit: 'ea', unitPrice: '88.00', costPrice: null, qtyOnHand: null, supplierId: null },
    // Same name as another row: the entry keyset has to break the tie on item_id
    // or name-ordered paging stalls forever on the duplicate.
    { itemId: 'i_elbow_b', name: 'Copper elbow 15mm', description: 'Solder ring', unit: 'ea', unitPrice: '5.40', costPrice: '1.80', qtyOnHand: '3', supplierId: 's_tradelink' },
    // No price at all — legal today, and it must stay honestly null rather than
    // being coerced to 0 somewhere in the fall-through.
    { itemId: 'i_nopricce', name: 'Zed unpriced widget', description: null, unit: 'ea', unitPrice: null, costPrice: null, qtyOnHand: null, supplierId: null },
];

async function q(sql: string, params: any[] = []): Promise<any[]> {
    return (await pglite.query(sql, params)).rows as any[];
}

/** Wipe every book except the seeded Standard, so each block starts clean. */
async function resetBooks(): Promise<void> {
    await q(`DELETE FROM price_books WHERE NOT is_default`);
    await q(`DELETE FROM price_book_entries WHERE price_book_id = $1 AND item_id NOT IN (SELECT item_id FROM price_book_items WHERE org_id = $2)`, [STD, ORG]);
}

beforeAll(async () => {
    pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };

    // Orgs and items must exist BEFORE 0037 runs, so the seed has something to copy.
    await executor.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    await runMigrations(executor);

    db = drizzle(pglite) as unknown as PgDb;
    repo = new PriceBooksPgRepo(db);
});

describe('0037 seed', () => {
    // Run in its own PGlite so the seed sees items that pre-date the migration —
    // which is the whole point of the backfill.
    let seedDb: PGlite;
    let seedExec: SqlExecutor;

    beforeAll(async () => {
        seedDb = new PGlite({ extensions: { pg_trgm } });
        seedExec = { exec: async (s: string) => ({ rows: (await seedDb.query(s)).rows as any[] }) };

        // Apply everything up to but NOT including 0037, then plant the pre-existing data.
        const fs = await import('fs');
        const path = await import('path');
        const dir = path.resolve(__dirname, '..', '..', 'drizzle');
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
        const { splitStatements } = await import('../pg/migrate');
        for (const f of files) {
            if (f >= '0037_') break;
            for (const s of splitStatements(fs.readFileSync(path.join(dir, f), 'utf-8'))) await seedExec.exec(s);
        }
        await seedDb.query(`INSERT INTO orgs (org_id, name) VALUES ('org_a', 'A'), ('org_b', 'B')`);
        await seedDb.query(
            `INSERT INTO price_book_items (item_id, org_id, name, unit_price, created_at, updated_at)
             VALUES ('a1','org_a','A one','10.00',now(),now()),
                    ('a2','org_a','A two','20.00',now(),now()),
                    ('a3','org_a','A unpriced',NULL,now(),now()),
                    ('b1','org_b','B one','30.00',now(),now())`,
        );
        // Record the pre-0037 files as applied so runMigrations picks up from 0037.
        await seedExec.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
        for (const f of files) {
            if (f >= '0037_') break;
            await seedExec.exec(`INSERT INTO _migrations (name) VALUES ('${f}') ON CONFLICT DO NOTHING`);
        }
        await runMigrations(seedExec);
    });

    it('gives every org exactly one Standard book, holding a copy of each item price', async () => {
        const books = (await seedDb.query(`SELECT * FROM price_books ORDER BY org_id`)).rows as any[];
        expect(books).toHaveLength(2);
        expect(books.map((b) => b.price_book_id)).toEqual(['pb_std_org_a', 'pb_std_org_b']);
        expect(books.every((b) => b.name === 'Standard' && b.type === 'standard' && b.is_default === true)).toBe(true);

        const entries = (await seedDb.query(
            `SELECT item_id, unit_price FROM price_book_entries WHERE price_book_id = 'pb_std_org_a' ORDER BY item_id`,
        )).rows as any[];
        expect(entries.map((e) => e.item_id)).toEqual(['a1', 'a2', 'a3']);
        expect(entries.map((e) => e.unit_price)).toEqual(['10.00', '20.00', null]);
    });

    it('is idempotent — replaying the migration mints no second book and no second entry', async () => {
        // Force a replay by forgetting 0037 was applied; nothing in it may double up.
        await seedDb.query(`DELETE FROM _migrations WHERE name LIKE '0037%'`);
        await runMigrations(seedExec);
        await seedDb.query(`DELETE FROM _migrations WHERE name LIKE '0037%'`);
        await runMigrations(seedExec);

        const [{ books }] = (await seedDb.query(`SELECT count(*)::int AS books FROM price_books`)).rows as any[];
        const [{ entries }] = (await seedDb.query(`SELECT count(*)::int AS entries FROM price_book_entries`)).rows as any[];
        expect(books).toBe(2);
        expect(entries).toBe(4);
        const [{ defaults }] = (await seedDb.query(
            `SELECT count(*)::int AS defaults FROM price_books WHERE org_id = 'org_a' AND is_default`,
        )).rows as any[];
        expect(defaults).toBe(1);
    });
});

describe('PriceBooksPgRepo', () => {
    beforeAll(async () => {
        await q(`INSERT INTO orgs (org_id, name) VALUES ($1,'Acme'), ($2,'Other') ON CONFLICT DO NOTHING`, [ORG, OTHER]);
        for (const r of SEED_ITEMS) {
            await q(
                `INSERT INTO price_book_items (item_id, org_id, name, description, unit, unit_price, cost_price, qty_on_hand, supplier_id, created_at, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
                [r.itemId, ORG, r.name, r.description, r.unit, r.unitPrice, r.costPrice, r.qtyOnHand, r.supplierId, D('2026-01-01T00:00:00Z')],
            );
        }
        // Another org's item — must never surface, and must be rejected as an entry.
        await q(
            `INSERT INTO price_book_items (item_id, org_id, name, unit_price, created_at, updated_at)
             VALUES ('i_foreign', $1, 'Copper elbow 15mm', '9.99', $2, $2)`,
            [OTHER, D('2026-01-01T00:00:00Z')],
        );

        // Both orgs existed before 0037 ran here, so both were seeded a Standard
        // book — but the items were planted after, so back-fill the Standard
        // entries the way the item-create path will in the backend.
        await repo.ensureDefaultBook(ORG);
        await repo.ensureDefaultBook(OTHER);
        for (const r of SEED_ITEMS) {
            await repo.upsertEntry({ orgId: ORG, priceBookId: STD, itemId: r.itemId, unitPrice: r.unitPrice == null ? null : Number(r.unitPrice) });
        }
    });

    beforeEach(resetBooks);

    // ---- default book -----------------------------------------------------

    describe('ensureDefaultBook', () => {
        it('is idempotent and always returns the same deterministic id', async () => {
            const a = await repo.ensureDefaultBook(ORG);
            const b = await repo.ensureDefaultBook(ORG);
            expect(a.priceBookId).toBe(STD);
            expect(b.priceBookId).toBe(a.priceBookId);
            const rows = await q(`SELECT count(*)::int AS c FROM price_books WHERE org_id = $1`, [ORG]);
            expect(rows[0].c).toBe(1);
        });

        it('creates one for an org that post-dates the migration', async () => {
            await q(`INSERT INTO orgs (org_id, name) VALUES ('org_new', 'New Co') ON CONFLICT DO NOTHING`);
            const book = await repo.ensureDefaultBook('org_new', 'bp_1');
            expect(book).toMatchObject({ priceBookId: 'pb_std_org_new', name: 'Standard', type: 'standard', isDefault: true, businessProfileId: 'bp_1' });
            await repo.ensureDefaultBook('org_new');
            const rows = await q(`SELECT count(*)::int AS c FROM price_books WHERE org_id = 'org_new'`);
            expect(rows[0].c).toBe(1);
        });
    });

    // ---- books ------------------------------------------------------------

    describe('createBook / updateBook / deleteBook', () => {
        it('replays safely on the same id and rejects a duplicate name', async () => {
            const input = { orgId: ORG, priceBookId: 'pb_a', name: 'Trade list', type: 'catalog' as const };
            const first = await repo.createBook(input);
            const again = await repo.createBook(input);   // a client retry
            expect(again.priceBookId).toBe(first.priceBookId);
            const rows = await q(`SELECT count(*)::int AS c FROM price_books WHERE org_id = $1 AND NOT is_default`, [ORG]);
            expect(rows[0].c).toBe(1);

            await expect(repo.createBook({ ...input, priceBookId: 'pb_b' })).rejects.toBeInstanceOf(PriceBookNameTaken);
            // Case-insensitive: "trade LIST" is the same book to a human.
            await expect(repo.createBook({ ...input, priceBookId: 'pb_c', name: 'trade LIST' })).rejects.toBeInstanceOf(PriceBookNameTaken);
        });

        it('never lets a caller mint a second default', async () => {
            const book = await repo.createBook({ orgId: ORG, priceBookId: 'pb_a', name: 'Trade list', type: 'catalog' });
            expect(book.isDefault).toBe(false);
            const rows = await q(`SELECT count(*)::int AS c FROM price_books WHERE org_id = $1 AND is_default`, [ORG]);
            expect(rows[0].c).toBe(1);
        });

        it('renames, and refuses a rename onto another book', async () => {
            await repo.createBook({ orgId: ORG, priceBookId: 'pb_a', name: 'Trade list', type: 'catalog' });
            await repo.createBook({ orgId: ORG, priceBookId: 'pb_b', name: 'Retail list', type: 'catalog' });

            const updated = await repo.updateBook(ORG, 'pb_a', { name: 'Wholesale list', description: 'For the yard' });
            expect(updated).toMatchObject({ name: 'Wholesale list', description: 'For the yard', type: 'catalog' });
            await expect(repo.updateBook(ORG, 'pb_a', { name: 'Retail list' })).rejects.toBeInstanceOf(PriceBookNameTaken);
            expect(await repo.updateBook(OTHER, 'pb_a', { name: 'Hijack' })).toBeNull();
        });

        it('deletes a catalogue and its entries but never its items; the default survives', async () => {
            await repo.createBook({ orgId: ORG, priceBookId: 'pb_a', name: 'Trade list', type: 'catalog' });
            await repo.addEntries(ORG, 'pb_a', ['i_elbow', 'i_tee']);

            expect(await repo.deleteBook(ORG, STD)).toBe('is_default');
            expect(await repo.getBook(ORG, STD)).not.toBeNull();

            expect(await repo.deleteBook(ORG, 'pb_a')).toBe('deleted');
            expect((await q(`SELECT count(*)::int AS c FROM price_book_entries WHERE price_book_id = 'pb_a'`))[0].c).toBe(0);
            // The warehouse is untouched — a catalogue is a collection OVER it.
            expect((await q(`SELECT count(*)::int AS c FROM price_book_items WHERE org_id = $1`, [ORG]))[0].c).toBe(SEED_ITEMS.length);

            expect(await repo.deleteBook(ORG, 'pb_a')).toBe('not_found');
        });
    });

    describe('listBooks', () => {
        beforeEach(async () => {
            for (let i = 1; i <= 7; i++) {
                await repo.createBook({ orgId: ORG, priceBookId: `pb_${i}`, name: `Book ${String(i).padStart(2, '0')}`, type: i % 2 ? 'catalog' : 'standard', description: i === 3 ? 'Wholesale yard pricing' : null });
            }
            await repo.createBook({ orgId: OTHER, priceBookId: 'pb_other', name: 'Foreign book', type: 'catalog' });
        });

        it('pages without skipping or repeating, and terminates', async () => {
            const seen: string[] = [];
            let cursor: { name: string; id: string } | null = null;
            for (let guard = 0; guard < 20; guard++) {
                const page: any = await repo.listBooks({ orgId: ORG, limit: 3, exclusiveStartKey: cursor });
                seen.push(...page.items.map((b: any) => b.priceBookId));
                expect(page.total).toBe(8);   // 7 + the seeded Standard
                cursor = page.lastEvaluatedKey;
                if (!cursor) break;
            }
            expect(seen).toHaveLength(8);
            expect(new Set(seen).size).toBe(8);
            expect(seen).toContain(STD);
        });

        it('scopes to the org', async () => {
            const page = await repo.listBooks({ orgId: ORG, limit: 100 });
            expect(page.items.every((b) => b.orgId === ORG)).toBe(true);
            expect(page.items.map((b) => b.priceBookId)).not.toContain('pb_other');
            expect(page.total).toBe(8);
        });

        it('filters by type and searches name + description in Postgres', async () => {
            const catalogs = await repo.listBooks({ orgId: ORG, type: 'catalog', limit: 100 });
            expect(catalogs.total).toBe(4);
            expect(catalogs.items.every((b) => b.type === 'catalog')).toBe(true);

            const standards = await repo.listBooks({ orgId: ORG, type: 'standard', limit: 100 });
            expect(standards.items.map((b) => b.priceBookId)).toContain(STD);

            const hit = await repo.listBooks({ orgId: ORG, search: 'wholesale yard', limit: 100 });
            expect(hit.items.map((b) => b.priceBookId)).toEqual(['pb_3']);
            expect(hit.total).toBe(1);
        });

        it('clamps the limit at 200 and reports itemCount', async () => {
            const page = await repo.listBooks({ orgId: ORG, limit: 5000 });
            expect(page.items.length).toBeLessThanOrEqual(200);
            const std = page.items.find((b) => b.priceBookId === STD)!;
            expect(std.itemCount).toBe(SEED_ITEMS.length);
            expect(page.items.find((b) => b.priceBookId === 'pb_1')!.itemCount).toBe(0);
        });
    });

    // ---- entries ----------------------------------------------------------

    describe('listEntries', () => {
        beforeEach(async () => {
            await repo.createBook({ orgId: ORG, priceBookId: 'pb_cat', name: 'Trade list', type: 'catalog' });
            // Added deliberately out of alphabetical order — a catalogue's order is
            // the order the owner put it in, not the alphabet.
            await repo.addEntries(ORG, 'pb_cat', ['i_solder', 'i_elbow', 'i_tee', 'i_callout']);
        });

        it('returns a catalogue in position order, and a standard book by name', async () => {
            const cat = await repo.listEntries({ orgId: ORG, priceBookId: 'pb_cat', order: 'position', defaultBookId: STD, limit: 50 });
            expect(cat.items.map((r) => r.itemId)).toEqual(['i_solder', 'i_elbow', 'i_tee', 'i_callout']);
            expect(cat.items.map((r) => r.position)).toEqual([100, 200, 300, 400]);

            const std = await repo.listEntries({ orgId: ORG, priceBookId: STD, order: 'name', limit: 50 });
            expect(std.items.map((r) => r.name)).toEqual([
                'Callout fee', 'Copper elbow 15mm', 'Copper elbow 15mm',
                'Labour standard hr', 'PVC tee 40mm', 'Solder 500g', 'Zed unpriced widget',
            ]);
        });

        it('pages stably in both orders, including across duplicate names', async () => {
            for (const [order, bookId, expected] of [['position', 'pb_cat', 4], ['name', STD, 7]] as const) {
                const seen: string[] = [];
                let cursor: any = null;
                for (let guard = 0; guard < 20; guard++) {
                    const page = await repo.listEntries({ orgId: ORG, priceBookId: bookId, order, defaultBookId: STD, limit: 2, exclusiveStartKey: cursor });
                    seen.push(...page.items.map((r) => r.itemId));
                    expect(page.total).toBe(expected);
                    cursor = page.lastEvaluatedKey;
                    if (!cursor) break;
                }
                expect(seen).toHaveLength(expected);
                expect(new Set(seen).size).toBe(expected);
            }
        });

        it('filters by kind and searches the joined item, in Postgres', async () => {
            const stocked = await repo.listEntries({ orgId: ORG, priceBookId: STD, order: 'name', kind: 'stocked', limit: 50 });
            expect(stocked.items.every((r) => r.qtyOnHand !== null)).toBe(true);
            expect(stocked.total).toBe(4);

            const services = await repo.listEntries({ orgId: ORG, priceBookId: STD, order: 'name', kind: 'services', limit: 50 });
            expect(services.items.map((r) => r.itemId).sort()).toEqual(['i_callout', 'i_labour', 'i_nopricce']);

            const hit = await repo.listEntries({ orgId: ORG, priceBookId: STD, order: 'name', search: 'solvent', limit: 50 });
            expect(hit.items.map((r) => r.itemId)).toEqual(['i_tee']);
            expect(hit.total).toBe(1);
        });

        it('carries the joined catalogue columns through untouched', async () => {
            const page = await repo.listEntries({ orgId: ORG, priceBookId: 'pb_cat', order: 'position', defaultBookId: STD, limit: 50 });
            expect(page.items.find((r) => r.itemId === 'i_solder')).toMatchObject({
                name: 'Solder 500g', unit: 'ea', costPrice: 24, qtyOnHand: 22, supplierId: 's_reece', reorderPoint: null,
            });
        });

        it('never leaks another org', async () => {
            const page = await repo.listEntries({ orgId: OTHER, priceBookId: 'pb_cat', order: 'position', limit: 50 });
            expect(page.items).toEqual([]);
            expect(page.total).toBe(0);
        });
    });

    describe('membership vs price — the mechanical difference', () => {
        beforeEach(async () => {
            await repo.createBook({ orgId: ORG, priceBookId: 'pb_cat', name: 'Trade list', type: 'catalog' });
            await repo.addEntries(ORG, 'pb_cat', ['i_elbow']);
        });

        it('a missing entry in a CATALOG book means NOT IN IT — the list does not fall through', async () => {
            // i_tee is priced in the org's Standard book, so it HAS a price.
            expect((await repo.resolvePrice(ORG, STD, 'i_tee')).price).toBe(3.8);
            // It is still not in this catalogue, and no fall-through puts it there.
            expect(await repo.getEntry(ORG, 'pb_cat', 'i_tee')).toBeNull();
            const page = await repo.listEntries({ orgId: ORG, priceBookId: 'pb_cat', order: 'position', defaultBookId: STD, limit: 50 });
            expect(page.items.map((r) => r.itemId)).toEqual(['i_elbow']);
            expect(page.total).toBe(1);
        });

        it('a missing entry in a STANDARD book falls through to the default book', async () => {
            const alt = await repo.createBook({ orgId: ORG, priceBookId: 'pb_alt', name: 'Alt quoting', type: 'standard' });
            expect(await repo.getEntry(ORG, alt.priceBookId, 'i_tee')).toBeNull();
            // Nothing was curated into it, yet quoting from it still prices the item.
            expect(await repo.resolvePrice(ORG, alt.priceBookId, 'i_tee')).toEqual({ price: 3.8, source: 'default-book' });
        });

        it('an item in NO catalogue is still priced — catalogues gate display, not sellability', async () => {
            await q(`DELETE FROM price_book_entries WHERE org_id = $1 AND item_id = 'i_labour'`, [ORG]);
            expect(await repo.getEntry(ORG, STD, 'i_labour')).toBeNull();
            expect(await repo.resolvePrice(ORG, null, 'i_labour')).toEqual({ price: 110, source: 'item' });
            // Repair for the rest of the suite.
            await repo.upsertEntry({ orgId: ORG, priceBookId: STD, itemId: 'i_labour', unitPrice: 110 });
        });
    });

    describe('resolvePrice', () => {
        it('falls through entry → default book → item → null', async () => {
            const cat = await repo.createBook({ orgId: ORG, priceBookId: 'pb_cat', name: 'Trade list', type: 'catalog' });
            // Curated in with NO price of its own: inherit.
            await repo.addEntries(ORG, cat.priceBookId, ['i_elbow', 'i_nopricce']);
            expect(await repo.resolvePrice(ORG, cat.priceBookId, 'i_elbow')).toEqual({ price: 6.9, source: 'default-book' });

            // Then repriced in this book only.
            await repo.upsertEntry({ orgId: ORG, priceBookId: cat.priceBookId, itemId: 'i_elbow', unitPrice: 5.5 });
            expect(await repo.resolvePrice(ORG, cat.priceBookId, 'i_elbow')).toEqual({ price: 5.5, source: 'entry' });
            // …and the Standard book is unmoved. A price is only meaningful RELATIVE
            // TO A BOOK.
            expect(await repo.resolvePrice(ORG, STD, 'i_elbow')).toEqual({ price: 6.9, source: 'entry' });

            // No price anywhere stays honestly null — never coerced to 0.
            expect(await repo.resolvePrice(ORG, cat.priceBookId, 'i_nopricce')).toEqual({ price: null, source: 'none' });
            // An unknown item is 'none', not a throw.
            expect(await repo.resolvePrice(ORG, cat.priceBookId, 'i_nope')).toEqual({ price: null, source: 'none' });
            // Another org's item is invisible even by id.
            expect(await repo.resolvePrice(ORG, cat.priceBookId, 'i_foreign')).toEqual({ price: null, source: 'none' });
        });

        it('gives the same item two prices in two catalogues, and one stock number', async () => {
            await repo.createBook({ orgId: ORG, priceBookId: 'pb_trade', name: 'Trade list', type: 'catalog' });
            await repo.createBook({ orgId: ORG, priceBookId: 'pb_retail', name: 'Retail list', type: 'catalog' });
            await repo.upsertEntry({ orgId: ORG, priceBookId: 'pb_trade', itemId: 'i_tee', unitPrice: 2.5 });
            await repo.upsertEntry({ orgId: ORG, priceBookId: 'pb_retail', itemId: 'i_tee', unitPrice: 7.95 });

            expect((await repo.resolvePrice(ORG, 'pb_trade', 'i_tee')).price).toBe(2.5);
            expect((await repo.resolvePrice(ORG, 'pb_retail', 'i_tee')).price).toBe(7.95);
            expect((await repo.resolvePrice(ORG, STD, 'i_tee')).price).toBe(3.8);

            // Stock belongs to the ITEM. No pricing write may have moved it.
            const trade = await repo.listEntries({ orgId: ORG, priceBookId: 'pb_trade', order: 'position', defaultBookId: STD, limit: 10 });
            const retail = await repo.listEntries({ orgId: ORG, priceBookId: 'pb_retail', order: 'position', defaultBookId: STD, limit: 10 });
            expect(trade.items[0].qtyOnHand).toBe(146);
            expect(retail.items[0].qtyOnHand).toBe(146);
        });

        it('batches, and marks an inherited row as inherited in the list', async () => {
            await repo.createBook({ orgId: ORG, priceBookId: 'pb_cat', name: 'Trade list', type: 'catalog' });
            await repo.addEntries(ORG, 'pb_cat', ['i_elbow', 'i_tee']);
            await repo.upsertEntry({ orgId: ORG, priceBookId: 'pb_cat', itemId: 'i_tee', unitPrice: 2.5 });

            const map = await repo.resolvePrices(ORG, 'pb_cat', ['i_elbow', 'i_tee', 'i_foreign']);
            expect(map.get('i_elbow')).toEqual({ price: 6.9, source: 'default-book' });
            expect(map.get('i_tee')).toEqual({ price: 2.5, source: 'entry' });
            expect(map.has('i_foreign')).toBe(false);

            const page = await repo.listEntries({ orgId: ORG, priceBookId: 'pb_cat', order: 'position', defaultBookId: STD, limit: 10 });
            expect(page.items.find((r) => r.itemId === 'i_elbow')).toMatchObject({ price: 6.9, inherited: true });
            expect(page.items.find((r) => r.itemId === 'i_tee')).toMatchObject({ price: 2.5, inherited: false });
        });
    });

    describe('upsertEntry / addEntries / removeEntry', () => {
        beforeEach(async () => {
            await repo.createBook({ orgId: ORG, priceBookId: 'pb_cat', name: 'Trade list', type: 'catalog' });
        });

        it('appends at max+100 and leaves an existing row where it is', async () => {
            const a = await repo.upsertEntry({ orgId: ORG, priceBookId: 'pb_cat', itemId: 'i_elbow' });
            const b = await repo.upsertEntry({ orgId: ORG, priceBookId: 'pb_cat', itemId: 'i_tee' });
            expect([a.position, b.position]).toEqual([100, 200]);

            // A repricing must not reshuffle the display list.
            const again = await repo.upsertEntry({ orgId: ORG, priceBookId: 'pb_cat', itemId: 'i_elbow', unitPrice: 4.2 });
            expect(again.position).toBe(100);
            expect(again.unitPrice).toBe(4.2);

            // Omitting the price leaves it; passing null reverts to inherited.
            expect((await repo.upsertEntry({ orgId: ORG, priceBookId: 'pb_cat', itemId: 'i_elbow' })).unitPrice).toBe(4.2);
            expect((await repo.upsertEntry({ orgId: ORG, priceBookId: 'pb_cat', itemId: 'i_elbow', unitPrice: null })).unitPrice).toBeNull();
        });

        it('adds in bulk, and adding the same ids again is inert', async () => {
            const first = await repo.addEntries(ORG, 'pb_cat', ['i_elbow', 'i_tee', 'i_solder']);
            expect(first).toEqual({ added: 3, skipped: 0 });
            const before = await q(`SELECT item_id, position FROM price_book_entries WHERE price_book_id = 'pb_cat' ORDER BY position`);

            const second = await repo.addEntries(ORG, 'pb_cat', ['i_elbow', 'i_tee', 'i_solder']);
            expect(second).toEqual({ added: 0, skipped: 3 });
            expect(await q(`SELECT item_id, position FROM price_book_entries WHERE price_book_id = 'pb_cat' ORDER BY position`)).toEqual(before);

            // A later batch appends past the existing tail rather than colliding.
            const third = await repo.addEntries(ORG, 'pb_cat', ['i_elbow', 'i_callout']);
            expect(third).toEqual({ added: 1, skipped: 1 });
            const positions = (await q(`SELECT position FROM price_book_entries WHERE price_book_id = 'pb_cat'`)).map((r) => r.position);
            expect(new Set(positions).size).toBe(positions.length);
        });

        it('removing is idempotent and never touches the item', async () => {
            await repo.addEntries(ORG, 'pb_cat', ['i_elbow']);
            await repo.removeEntry(ORG, 'pb_cat', 'i_elbow');
            await repo.removeEntry(ORG, 'pb_cat', 'i_elbow');
            expect(await repo.getEntry(ORG, 'pb_cat', 'i_elbow')).toBeNull();
            expect((await q(`SELECT count(*)::int AS c FROM price_book_items WHERE item_id = 'i_elbow'`))[0].c).toBe(1);
        });

        it('cannot reach across tenants — the composite FK, not the code, is the wall', async () => {
            // Another org's ITEM into our book.
            await expect(repo.upsertEntry({ orgId: ORG, priceBookId: 'pb_cat', itemId: 'i_foreign' })).rejects.toThrow();
            // Our item into another org's BOOK, claiming our org id.
            await repo.createBook({ orgId: OTHER, priceBookId: 'pb_theirs', name: 'Theirs', type: 'catalog' });
            await expect(repo.upsertEntry({ orgId: ORG, priceBookId: 'pb_theirs', itemId: 'i_elbow' })).rejects.toThrow();
            expect((await q(`SELECT count(*)::int AS c FROM price_book_entries WHERE price_book_id = 'pb_theirs'`))[0].c).toBe(0);
        });
    });

    describe('reorderEntries', () => {
        beforeEach(async () => {
            await repo.createBook({ orgId: ORG, priceBookId: 'pb_cat', name: 'Trade list', type: 'catalog' });
            await repo.addEntries(ORG, 'pb_cat', ['i_elbow', 'i_tee', 'i_solder']);
        });

        const order = async () => (await q(`SELECT item_id, position FROM price_book_entries WHERE price_book_id = 'pb_cat' ORDER BY position, item_id`));

        it('rewrites positions to ordinality*100, and repeating it changes nothing', async () => {
            await repo.reorderEntries(ORG, 'pb_cat', ['i_solder', 'i_elbow', 'i_tee']);
            expect(await order()).toEqual([
                { item_id: 'i_solder', position: 100 },
                { item_id: 'i_elbow', position: 200 },
                { item_id: 'i_tee', position: 300 },
            ]);
            await repo.reorderEntries(ORG, 'pb_cat', ['i_solder', 'i_elbow', 'i_tee']);
            expect(await order()).toEqual([
                { item_id: 'i_solder', position: 100 },
                { item_id: 'i_elbow', position: 200 },
                { item_id: 'i_tee', position: 300 },
            ]);
        });

        it('refuses a partial, over-full, duplicated or cross-tenant order and leaves positions untouched', async () => {
            const before = await order();
            for (const bad of [
                ['i_solder', 'i_elbow'],                            // partial
                ['i_solder', 'i_elbow', 'i_tee', 'i_callout'],      // an item not in the book
                ['i_solder', 'i_solder', 'i_tee'],                  // duplicated
                ['i_solder', 'i_elbow', 'i_foreign'],               // another org's item
            ]) {
                await expect(repo.reorderEntries(ORG, 'pb_cat', bad)).rejects.toBeInstanceOf(PriceBookReorderMismatch);
                expect(await order()).toEqual(before);
            }
            // Another org cannot reorder our book either.
            await expect(repo.reorderEntries(OTHER, 'pb_cat', ['i_solder', 'i_elbow', 'i_tee'])).rejects.toBeInstanceOf(PriceBookReorderMismatch);
            expect(await order()).toEqual(before);
        });
    });
});
