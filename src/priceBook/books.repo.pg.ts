import { and, asc, eq, gt, ilike, or, sql, getTableColumns } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { priceBooks, priceBookEntries } from '../pg/schema/priceBooks';
import { fromRow } from '../pg/rows';
import type {
    PriceBook, PriceBookListItem, PriceBookEntry, PriceBookEntryRow,
    PriceBookType, ResolvedPrice,
} from './books.schema';

/** A book has no NUMERIC columns; itemCount arrives as ::int, already a number. */
const BOOK_NUM: string[] = [];
const ENTRY_NUM = ['unitPrice'];

const NAME_UIDX = 'price_books_org_name_uidx';

/** Thrown when a book name collides with another book in the same org (case-insensitive). */
export class PriceBookNameTaken extends Error {
    constructor(name: string) {
        super(`A price book named "${name}" already exists`);
        this.name = 'PriceBookNameTaken';
    }
}

/** Thrown when a reorder's item set is not exactly the book's item set. */
export class PriceBookReorderMismatch extends Error {
    constructor() {
        super('The order sent does not cover the whole book');
        this.name = 'PriceBookReorderMismatch';
    }
}

export interface ListBooksParams {
    orgId: string;
    type?: PriceBookType;
    /** Free text over name + description — ILIKE, matched in Postgres. */
    search?: string;
    limit?: number;
    /** Decoded keyset cursor from the previous page: `{ name, id }`. */
    exclusiveStartKey?: { name?: string; id?: string } | null;
}

export interface PriceBooksPage {
    items: PriceBookListItem[];
    /** Keyset for the next page, or null at the end. The handler base64-wraps it. */
    lastEvaluatedKey: { name: string; id: string } | null;
    total: number;
}

export interface ListEntriesParams {
    orgId: string;
    priceBookId: string;
    /**
     * REQUIRED — the caller has already fetched the book, so it knows the type:
     * catalog → 'position' (the book IS a display list), standard → 'name'
     * (a reference list people scan alphabetically).
     */
    order: 'position' | 'name';
    /**
     * The org's default book, for the second fall-through hop. Omit/null when
     * `priceBookId` IS the default book.
     */
    defaultBookId?: string | null;
    /** Free text over the item's name/description/unit. */
    search?: string;
    kind?: 'stocked' | 'services';
    limit?: number;
    exclusiveStartKey?: { position?: number; name?: string; id?: string } | null;
}

export interface PriceBookEntriesPage {
    items: PriceBookEntryRow[];
    lastEvaluatedKey: { position?: number; name?: string; id: string } | null;
    total: number;
}

/**
 * How many priced rows a book holds.
 *
 * The outer column is spelled out rather than interpolated: drizzle renders
 * `${priceBooks.priceBookId}` UNQUALIFIED inside a raw fragment, which the
 * subquery's own scope then captures — `e.price_book_id = price_book_id`
 * silently becomes a tautology and every book reports the org's whole entry
 * count. Qualifying it is what makes the correlation real.
 */
const ITEM_COUNT = sql<number>`(SELECT count(*)::int FROM price_book_entries e WHERE e.price_book_id = ${sql.raw('"price_books"."price_book_id"')})`;

function isUniqueViolation(err: any, constraint: string): boolean {
    const msg = String(err?.message ?? '');
    return msg.includes(constraint)
        || err?.constraint === constraint
        || err?.constraint_name === constraint
        || String(err?.cause?.message ?? '').includes(constraint);
}

/** RETURNING rows come back snake_case and untyped — `fromRow` needs drizzle metadata. */
function toEntry(r: any): PriceBookEntry {
    return {
        orgId: r.org_id,
        priceBookId: r.price_book_id,
        itemId: r.item_id,
        unitPrice: r.unit_price == null ? null : Number(r.unit_price),
        position: Number(r.position),
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    };
}

/** Joined entry+item row — same reason as `toEntry`: no drizzle column metadata. */
function toEntryRow(r: any): PriceBookEntryRow {
    const num = (v: any) => (v == null ? null : Number(v));
    return {
        priceBookId: r.price_book_id,
        itemId: r.item_id,
        position: Number(r.position),
        price: num(r.price),
        inherited: r.inherited === true || r.inherited === 't',
        name: r.name ?? '',
        description: r.description ?? null,
        unit: r.unit ?? null,
        costPrice: num(r.cost_price),
        qtyOnHand: num(r.qty_on_hand),
        reorderPoint: num(r.reorder_point),
        supplierId: r.supplier_id ?? null,
    };
}

function rowsOf(result: any): any[] {
    return result?.rows ?? result ?? [];
}

/**
 * Pricebooks and their catalogue entries (0037).
 *
 * Postgres-only by design — like `PayerAliasPgRepo` / `MerchantCategoryPgRepo`
 * there is no Dynamo implementation and no routing wrapper, because this is a
 * relational join entity that is paged, searched and reported on. It is read the
 * same way regardless of any cutover flag.
 *
 * The standard/catalog distinction is MECHANICAL, and this class is where that
 * shows up:
 *   - membership is `getEntry` / `listEntries`. For a catalog book a missing
 *     entry means NOT IN THIS CATALOGUE — that is the whole point of the type.
 *   - price is `resolvePrice`, which is a MONEY question and therefore ALWAYS
 *     falls through (entry → default book → item), catalog or not. A quote must
 *     never fail to price an item just because nobody curated it into a list.
 *   - order is `position`, and it only means anything for a catalog book, which
 *     is a display list.
 *
 * Nothing here ever writes stock. `qtyOnHand` belongs to the catalogue item, so
 * the same item in two catalogues at two prices still has exactly one stock
 * number.
 */
export class PriceBooksPgRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    // ---- books ------------------------------------------------------------

    /**
     * Paginated + searched books, ordered by name. Keyset on (name, priceBookId)
     * — names are unique per org today, but the id tie-break costs nothing and
     * keeps paging stable if that ever relaxes.
     */
    async listBooks(params: ListBooksParams): Promise<PriceBooksPage> {
        const limit = Math.min(Math.max(params.limit ?? 20, 1), 200);
        const conds: any[] = [eq(priceBooks.orgId, params.orgId)];

        const q = params.search?.trim();
        if (q) {
            const like = `%${q}%`;
            conds.push(or(ilike(priceBooks.name, like), ilike(priceBooks.description, like)));
        }
        if (params.type) conds.push(eq(priceBooks.type, params.type));

        const where = and(...conds);
        const countPromise = this.db
            .select({ c: sql<number>`count(*)::int` })
            .from(priceBooks)
            .where(where);

        const pageConds = [...conds];
        const cursor = params.exclusiveStartKey;
        if (cursor?.name != null && cursor?.id) {
            pageConds.push(or(
                gt(priceBooks.name, cursor.name),
                and(eq(priceBooks.name, cursor.name), gt(priceBooks.priceBookId, cursor.id)),
            ));
        }

        // One extra row tells us whether another page exists without a second query.
        const rows = await this.db.select({
            ...getTableColumns(priceBooks),
            itemCount: ITEM_COUNT,
        })
            .from(priceBooks)
            .where(and(...pageConds))
            .orderBy(asc(priceBooks.name), asc(priceBooks.priceBookId))
            .limit(limit + 1);

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page[page.length - 1] as any;

        return {
            items: page.map((r: any) => fromRow<PriceBookListItem>(r, BOOK_NUM)),
            lastEvaluatedKey: hasMore && last ? { name: last.name ?? '', id: last.priceBookId } : null,
            total: Number((await countPromise)[0]?.c ?? 0),
        };
    }

    async getBook(orgId: string, priceBookId: string): Promise<PriceBookListItem | null> {
        const rows = await this.db.select({
            ...getTableColumns(priceBooks),
            itemCount: ITEM_COUNT,
        })
            .from(priceBooks)
            .where(and(eq(priceBooks.orgId, orgId), eq(priceBooks.priceBookId, priceBookId)))
            .limit(1);
        return rows[0] ? fromRow<PriceBookListItem>(rows[0], BOOK_NUM) : null;
    }

    async getDefaultBook(orgId: string): Promise<PriceBook | null> {
        const rows = await this.db.select().from(priceBooks)
            .where(and(eq(priceBooks.orgId, orgId), eq(priceBooks.isDefault, true)))
            .limit(1);
        return rows[0] ? fromRow<PriceBook>(rows[0], BOOK_NUM) : null;
    }

    /**
     * The org's fall-through book, created on demand.
     *
     * Idempotent twice over: the id is DERIVED from the org (`pb_std_<orgId>`,
     * the same id the 0037 seed mints) so a retry cannot produce a second one,
     * and the partial unique index on (org_id) WHERE is_default makes a second
     * default structurally impossible even under a concurrent call. Orgs created
     * after 0037 ran get their book here rather than from a backfill.
     */
    async ensureDefaultBook(orgId: string, businessProfileId?: string | null): Promise<PriceBook> {
        const priceBookId = `pb_std_${orgId}`;
        // No conflict target: pk, the (org_id, price_book_id) key, the name index
        // and the one-default-per-org index are all legitimate "already there".
        await this.db.insert(priceBooks).values({
            priceBookId,
            orgId,
            businessProfileId: businessProfileId ?? null,
            name: 'Standard',
            type: 'standard',
            isDefault: true,
        } as any).onConflictDoNothing();

        const existing = await this.getDefaultBook(orgId);
        if (existing) return existing;
        // Only reachable if the org has no default but the id is taken by a
        // non-default book — read it back rather than inventing a second id.
        const byId = await this.getBook(orgId, priceBookId);
        if (byId) {
            const { itemCount: _ignored, ...book } = byId;
            return book as PriceBook;
        }
        throw new Error(`[priceBooks] could not ensure a default book for org ${orgId}`);
    }

    /**
     * Create a book. The caller mints the ULID so a client retry replays the same
     * id and lands on ON CONFLICT DO NOTHING instead of a duplicate row.
     *
     * `isDefault` is deliberately not settable — an org has exactly one default
     * book and it is the one the seed made.
     */
    async createBook(input: {
        orgId: string; priceBookId: string; name: string; type: PriceBookType;
        businessProfileId?: string | null; description?: string | null;
    }): Promise<PriceBook> {
        try {
            await this.db.insert(priceBooks).values({
                priceBookId: input.priceBookId,
                orgId: input.orgId,
                businessProfileId: input.businessProfileId ?? null,
                name: input.name,
                type: input.type,
                isDefault: false,
                description: input.description ?? null,
            } as any).onConflictDoNothing({ target: priceBooks.priceBookId });
        } catch (err) {
            if (!isUniqueViolation(err, NAME_UIDX)) throw err;
            // A retry of OUR insert can surface as the name index rather than the
            // pk one (Postgres does not promise which index is checked first), so
            // a row already under this id means this was a replay, not a clash.
            const mine = await this.getBook(input.orgId, input.priceBookId);
            if (mine) return stripCount(mine);
            throw new PriceBookNameTaken(input.name);
        }
        const created = await this.getBook(input.orgId, input.priceBookId);
        if (!created) throw new PriceBookNameTaken(input.name);
        return stripCount(created);
    }

    /** name/description only. `type` and `isDefault` are IMMUTABLE. */
    async updateBook(
        orgId: string,
        priceBookId: string,
        patch: { name?: string; description?: string | null },
    ): Promise<PriceBook | null> {
        const set: Record<string, any> = { updatedAt: sql`now()` };
        if (patch.name !== undefined) set.name = patch.name;
        if (patch.description !== undefined) set.description = patch.description;
        if (Object.keys(set).length === 1) {
            const current = await this.getBook(orgId, priceBookId);
            return current ? stripCount(current) : null;
        }
        try {
            const rows = await this.db.update(priceBooks).set(set)
                .where(and(eq(priceBooks.orgId, orgId), eq(priceBooks.priceBookId, priceBookId)))
                .returning();
            return rows[0] ? fromRow<PriceBook>(rows[0], BOOK_NUM) : null;
        } catch (err) {
            if (isUniqueViolation(err, NAME_UIDX)) throw new PriceBookNameTaken(patch.name ?? '');
            throw err;
        }
    }

    /**
     * Delete a book. The default book is undeletable — an org must always have a
     * fall-through book, and the guard is in the WHERE clause so the check and the
     * delete cannot disagree. Entries cascade; the ITEMS are untouched, because a
     * catalogue is a collection over the warehouse, not the warehouse.
     */
    async deleteBook(orgId: string, priceBookId: string): Promise<'deleted' | 'not_found' | 'is_default'> {
        const deleted = await this.db.delete(priceBooks)
            .where(and(
                eq(priceBooks.orgId, orgId),
                eq(priceBooks.priceBookId, priceBookId),
                eq(priceBooks.isDefault, false),
            ))
            .returning({ id: priceBooks.priceBookId });
        if (deleted.length > 0) return 'deleted';
        const still = await this.getBook(orgId, priceBookId);
        return still ? 'is_default' : 'not_found';
    }

    // ---- entries ----------------------------------------------------------

    /**
     * One page of a book's items, joined to the catalogue.
     *
     * An INNER join on entries: for a catalog book that is the membership answer
     * (no entry = not in this catalogue). `price` is the fall-through
     * COALESCE(entry, default-book entry, item) and `inherited` says the number
     * did not come from this book's own entry, so the UI can show it muted.
     *
     * Keyset on (position, item_id) or (name, item_id) — neither position nor
     * name is unique, so the id tie-break is what stops paging stalling on a
     * duplicate.
     */
    async listEntries(params: ListEntriesParams): Promise<PriceBookEntriesPage> {
        const limit = Math.min(Math.max(params.limit ?? 20, 1), 200);
        const { orgId, priceBookId } = params;
        const useDefault = !!params.defaultBookId && params.defaultBookId !== priceBookId;

        const defJoin = useDefault
            ? sql` LEFT JOIN price_book_entries d ON d.org_id = ${orgId} AND d.price_book_id = ${params.defaultBookId} AND d.item_id = e.item_id`
            : sql.empty();
        const defPrice = useDefault ? sql`d.unit_price` : sql`NULL::numeric`;

        const conds: any[] = [
            sql`e.org_id = ${orgId}`,
            sql`e.price_book_id = ${priceBookId}`,
        ];
        const q = params.search?.trim();
        if (q) {
            const like = `%${q}%`;
            conds.push(sql`(i.name ILIKE ${like} OR i.description ILIKE ${like} OR i.unit ILIKE ${like})`);
        }
        if (params.kind === 'stocked') conds.push(sql`i.qty_on_hand IS NOT NULL`);
        if (params.kind === 'services') conds.push(sql`i.qty_on_hand IS NULL`);

        const baseWhere = sql.join(conds, sql` AND `);

        const countPromise = this.db.execute(sql`
            SELECT count(*)::int AS c
            FROM price_book_entries e
            JOIN price_book_items i ON i.org_id = e.org_id AND i.item_id = e.item_id
            WHERE ${baseWhere}
        `);

        const pageConds = [...conds];
        const cursor = params.exclusiveStartKey;
        if (params.order === 'position' && cursor?.position != null && cursor?.id) {
            pageConds.push(sql`(e.position > ${cursor.position} OR (e.position = ${cursor.position} AND e.item_id > ${cursor.id}))`);
        } else if (params.order === 'name' && cursor?.name != null && cursor?.id) {
            pageConds.push(sql`(COALESCE(i.name, '') > ${cursor.name} OR (COALESCE(i.name, '') = ${cursor.name} AND e.item_id > ${cursor.id}))`);
        }
        const orderBy = params.order === 'position'
            ? sql`e.position ASC, e.item_id ASC`
            : sql`COALESCE(i.name, '') ASC, e.item_id ASC`;

        const result: any = await this.db.execute(sql`
            SELECT e.price_book_id, e.item_id, e.position,
                   COALESCE(e.unit_price, ${defPrice}, i.unit_price) AS price,
                   (e.unit_price IS NULL) AS inherited,
                   COALESCE(i.name, '') AS name, i.description, i.unit,
                   i.cost_price, i.qty_on_hand, i.reorder_point, i.supplier_id
            FROM price_book_entries e
            JOIN price_book_items i ON i.org_id = e.org_id AND i.item_id = e.item_id${defJoin}
            WHERE ${sql.join(pageConds, sql` AND `)}
            ORDER BY ${orderBy}
            LIMIT ${limit + 1}
        `);

        const rows = rowsOf(result);
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page[page.length - 1];

        let lastEvaluatedKey: PriceBookEntriesPage['lastEvaluatedKey'] = null;
        if (hasMore && last) {
            lastEvaluatedKey = params.order === 'position'
                ? { position: Number(last.position), id: last.item_id }
                : { name: last.name ?? '', id: last.item_id };
        }

        return {
            items: page.map(toEntryRow),
            lastEvaluatedKey,
            total: Number(rowsOf(await countPromise)[0]?.c ?? 0),
        };
    }

    /**
     * Is this item in this book, and at what own price?
     *
     * This — not `resolvePrice` — is the membership question. For a catalog book
     * `null` means NOT IN THIS CATALOGUE.
     */
    async getEntry(orgId: string, priceBookId: string, itemId: string): Promise<PriceBookEntry | null> {
        const rows = await this.db.select().from(priceBookEntries)
            .where(and(
                eq(priceBookEntries.orgId, orgId),
                eq(priceBookEntries.priceBookId, priceBookId),
                eq(priceBookEntries.itemId, itemId),
            ))
            .limit(1);
        return rows[0] ? fromRow<PriceBookEntry>(rows[0], ENTRY_NUM) : null;
    }

    /**
     * Put an item in a book at a price. Adding an item to a catalogue IS this call.
     *
     * `unitPrice` omitted leaves any existing price alone; `unitPrice: null`
     * explicitly reverts the row to inherited. `position` omitted appends at
     * max+100 on a new row and leaves an existing row where it is — so a repeated
     * call is inert rather than quietly reshuffling the list.
     *
     * Cross-tenant is impossible here rather than merely unlikely: the composite
     * FKs on (org_id, price_book_id) and (org_id, item_id) reject an item or book
     * belonging to another org at the database, not in this method.
     */
    async upsertEntry(e: {
        orgId: string; priceBookId: string; itemId: string;
        unitPrice?: number | null; position?: number | null;
    }): Promise<PriceBookEntry> {
        const priceGiven = e.unitPrice !== undefined;
        const posGiven = e.position !== undefined && e.position !== null;

        const priceInsert = priceGiven && e.unitPrice !== null
            ? sql`${String(e.unitPrice)}::numeric`
            : sql`NULL::numeric`;
        const posInsert = posGiven
            ? sql`${e.position}::integer`
            : sql`(SELECT COALESCE(MAX(position), 0) + 100 FROM price_book_entries WHERE price_book_id = ${e.priceBookId})`;
        const priceSet = priceGiven ? sql`EXCLUDED.unit_price` : sql`price_book_entries.unit_price`;
        const posSet = posGiven ? sql`EXCLUDED.position` : sql`price_book_entries.position`;

        const result: any = await this.db.execute(sql`
            INSERT INTO price_book_entries (org_id, price_book_id, item_id, unit_price, position)
            VALUES (${e.orgId}, ${e.priceBookId}, ${e.itemId}, ${priceInsert}, ${posInsert})
            ON CONFLICT (price_book_id, item_id) DO UPDATE SET
                unit_price = ${priceSet},
                position = ${posSet},
                updated_at = now()
            RETURNING *
        `);
        const row = rowsOf(result)[0];
        if (!row) throw new Error('[priceBooks] upsertEntry returned no row');
        return toEntry(row);
    }

    /**
     * Bulk add-to-catalogue — the primary way a product gets linked to a
     * catalogue item. Entries land with a NULL price (inherit), because curating
     * a list is not the same act as repricing it.
     *
     * `ON CONFLICT DO NOTHING`, and the append base is read in the statement's own
     * snapshot, so running it twice adds nothing and moves nothing.
     */
    async addEntries(orgId: string, priceBookId: string, itemIds: string[]): Promise<{ added: number; skipped: number }> {
        const ids = [...new Set(itemIds.map((i) => (i ?? '').trim()).filter((i) => i.length > 0))];
        if (ids.length === 0) return { added: 0, skipped: 0 };

        const values = sql.join(ids.map((id, i) => sql`(${id}::text, ${i + 1}::integer)`), sql`, `);
        const result: any = await this.db.execute(sql`
            INSERT INTO price_book_entries (org_id, price_book_id, item_id, position)
            SELECT ${orgId}, ${priceBookId}, v.item_id,
                   (SELECT COALESCE(MAX(position), 0) FROM price_book_entries WHERE price_book_id = ${priceBookId}) + v.ord * 100
            FROM (VALUES ${values}) AS v(item_id, ord)
            ON CONFLICT (price_book_id, item_id) DO NOTHING
            RETURNING item_id
        `);
        const added = rowsOf(result).length;
        return { added, skipped: ids.length - added };
    }

    /**
     * Take an item out of a book. Idempotent, and it never touches the item —
     * removing something from a catalogue must not remove it from the warehouse.
     */
    async removeEntry(orgId: string, priceBookId: string, itemId: string): Promise<void> {
        await this.db.delete(priceBookEntries).where(and(
            eq(priceBookEntries.orgId, orgId),
            eq(priceBookEntries.priceBookId, priceBookId),
            eq(priceBookEntries.itemId, itemId),
        ));
    }

    /**
     * Rewrite a catalog book's display order. `itemIds` must be EXACTLY the set
     * of item ids in the book.
     *
     * The completeness check lives INSIDE the statement, so a partial order can
     * never half-apply: if the sent set is not the book's set, zero rows update
     * and `PriceBookReorderMismatch` is thrown with positions untouched.
     * Positions become ordinality*100, so running the same order twice is
     * byte-identical.
     */
    async reorderEntries(orgId: string, priceBookId: string, itemIds: string[]): Promise<void> {
        const ids = itemIds.map((i) => (i ?? '').trim()).filter((i) => i.length > 0);
        // A duplicate id would satisfy the count guard while making the UPDATE's
        // choice of position arbitrary — reject it before touching the table.
        if (new Set(ids).size !== ids.length) throw new PriceBookReorderMismatch();

        if (ids.length === 0) {
            const c: any = await this.db.execute(sql`
                SELECT count(*)::int AS c FROM price_book_entries
                WHERE org_id = ${orgId} AND price_book_id = ${priceBookId}
            `);
            if (Number(rowsOf(c)[0]?.c ?? 0) !== 0) throw new PriceBookReorderMismatch();
            return;
        }

        const values = sql.join(ids.map((id, i) => sql`(${id}::text, ${i + 1}::integer)`), sql`, `);
        const result: any = await this.db.execute(sql`
            WITH given AS (
                SELECT v.item_id, v.ord FROM (VALUES ${values}) AS v(item_id, ord)
            ), chk AS (
                SELECT (SELECT count(*) FROM price_book_entries
                          WHERE org_id = ${orgId} AND price_book_id = ${priceBookId}) AS have,
                       (SELECT count(*) FROM given) AS sent,
                       (SELECT count(*) FROM given g
                          JOIN price_book_entries e2 ON e2.org_id = ${orgId}
                                                    AND e2.price_book_id = ${priceBookId}
                                                    AND e2.item_id = g.item_id) AS matched
            )
            UPDATE price_book_entries e
               SET position = g.ord * 100, updated_at = now()
              FROM given g, chk
             WHERE e.org_id = ${orgId} AND e.price_book_id = ${priceBookId} AND e.item_id = g.item_id
               AND chk.have = chk.sent AND chk.sent = chk.matched
            RETURNING e.item_id
        `);
        if (rowsOf(result).length !== ids.length) throw new PriceBookReorderMismatch();
    }

    // ---- price resolution -------------------------------------------------

    /**
     * What does this item cost IN THIS BOOK?
     *
     * entry(book) → entry(default book) → item.unit_price → null. `priceBookId:
     * null` means "no book given" and starts at the default book.
     *
     * This ALWAYS falls through, catalog book or not, because it is a money
     * question and quoting must never fail to price an item just because nobody
     * curated it into a list. Whether the item is IN the book is a different
     * question, answered by `getEntry`/`listEntries`.
     */
    async resolvePrice(orgId: string, priceBookId: string | null, itemId: string): Promise<ResolvedPrice> {
        const map = await this.resolvePrices(orgId, priceBookId, [itemId]);
        return map.get(itemId) ?? { price: null, source: 'none' };
    }

    /** Batched `resolvePrice` for list/render paths. Chunked so the IN list stays sane. */
    async resolvePrices(
        orgId: string,
        priceBookId: string | null,
        itemIds: string[],
    ): Promise<Map<string, ResolvedPrice>> {
        const out = new Map<string, ResolvedPrice>();
        const ids = [...new Set(itemIds.map((i) => (i ?? '').trim()).filter((i) => i.length > 0))];
        if (!orgId || ids.length === 0) return out;

        // The default book is found in the same statement — one round trip, and the
        // caller does not have to know which book is the fall-through one.
        const entryJoin = priceBookId
            ? sql` LEFT JOIN price_book_entries e ON e.org_id = ${orgId} AND e.price_book_id = ${priceBookId} AND e.item_id = i.item_id`
            : sql.empty();
        const entryPrice = priceBookId ? sql`e.unit_price` : sql`NULL::numeric`;

        const CHUNK = 200;
        for (let k = 0; k < ids.length; k += CHUNK) {
            const chunk = ids.slice(k, k + CHUNK);
            const list = sql.join(chunk.map((id) => sql`${id}`), sql`, `);
            const result: any = await this.db.execute(sql`
                SELECT i.item_id,
                       ${entryPrice} AS entry_price,
                       d.unit_price AS default_price,
                       i.unit_price AS item_price
                FROM price_book_items i${entryJoin}
                LEFT JOIN price_book_entries d
                       ON d.org_id = ${orgId}
                      AND d.price_book_id = (SELECT price_book_id FROM price_books WHERE org_id = ${orgId} AND is_default)
                      AND d.item_id = i.item_id
                WHERE i.org_id = ${orgId} AND i.item_id IN (${list})
            `);
            for (const r of rowsOf(result)) {
                if (r.entry_price != null) out.set(r.item_id, { price: Number(r.entry_price), source: 'entry' });
                else if (r.default_price != null) out.set(r.item_id, { price: Number(r.default_price), source: 'default-book' });
                else if (r.item_price != null) out.set(r.item_id, { price: Number(r.item_price), source: 'item' });
                else out.set(r.item_id, { price: null, source: 'none' });
            }
        }
        return out;
    }
}

function stripCount(b: PriceBookListItem): PriceBook {
    const { itemCount: _ignored, ...book } = b;
    return book;
}
