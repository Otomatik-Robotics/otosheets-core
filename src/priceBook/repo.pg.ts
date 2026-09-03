import { and, asc, eq, gt, ilike, or, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { priceBookItems } from '../pg/schema/opsEntities';
import { toRow, fromRow } from '../pg/rows';
import { PriceBookItem } from './schema';
import type { IPriceBookRepo } from './repo';

const NUM = ['unitPrice', 'costPrice', 'qtyOnHand', 'reorderPoint'];

export interface ListPriceBookParams {
    orgId: string;
    /** Free text over name, description and unit — ILIKE, matched in Postgres. */
    search?: string;
    /** 'stocked' = has a quantity; 'services' = has none. */
    kind?: 'stocked' | 'services';
    /** Only items bought from this supplier. */
    supplierId?: string;
    limit?: number;
    /** Decoded keyset cursor from the previous page: `{ name, id }`. */
    exclusiveStartKey?: { name?: string; id?: string } | null;
}

export interface PriceBookPage {
    items: PriceBookItem[];
    /** Keyset for the next page, or null at the end. The handler base64-wraps it. */
    lastEvaluatedKey: { name: string; id: string } | null;
    /** Count over the full filtered set, so the UI can say "18 items". */
    total: number;
}

/** Price-book items are keyed (orgId, itemId) in Dynamo; itemId is a ULID PK here. */
export class PriceBookPgRepo implements IPriceBookRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    async getItem(orgId: string, itemId: string): Promise<PriceBookItem | null> {
        const r = await this.db.select().from(priceBookItems).where(and(eq(priceBookItems.orgId, orgId), eq(priceBookItems.itemId, itemId))).limit(1);
        return r[0] ? fromRow<PriceBookItem>(r[0], NUM) : null;
    }
    async listItems(orgId: string): Promise<PriceBookItem[]> {
        return (await this.db.select().from(priceBookItems).where(eq(priceBookItems.orgId, orgId))).map((r: any) => fromRow<PriceBookItem>(r, NUM));
    }
    /**
     * Paginated + searched price book, ordered by name.
     *
     * Name order rather than newest-first, because a price book is a REFERENCE
     * list people scan alphabetically, not a feed. Keyset on (name, itemId) —
     * name alone is not unique, so the id breaks ties and keeps paging stable
     * when two items share a name.
     *
     * Search is ILIKE in Postgres, not a filter in the Lambda: the endpoint used
     * to return every row and the page filtered in memory, which silently caps
     * out at the payload limit and makes search miss anything past it.
     */
    async listPaginated(params: ListPriceBookParams): Promise<PriceBookPage> {
        const limit = Math.min(Math.max(params.limit ?? 20, 1), 200);
        const conds: any[] = [eq(priceBookItems.orgId, params.orgId)];

        const q = params.search?.trim();
        if (q) {
            const like = `%${q}%`;
            conds.push(or(
                ilike(priceBookItems.name, like),
                ilike(priceBookItems.description, like),
                ilike(priceBookItems.unit, like),
            ));
        }
        if (params.kind === 'stocked') conds.push(sql`${priceBookItems.qtyOnHand} IS NOT NULL`);
        if (params.kind === 'services') conds.push(sql`${priceBookItems.qtyOnHand} IS NULL`);
        if (params.supplierId) conds.push(eq(priceBookItems.supplierId, params.supplierId));

        const where = and(...conds);
        // Total over the full filtered set — issued alongside the page query.
        const countPromise = this.db
            .select({ c: sql<number>`count(*)::int` })
            .from(priceBookItems)
            .where(where);

        const pageConds = [...conds];
        const cursor = params.exclusiveStartKey;
        if (cursor?.name != null && cursor?.id) {
            pageConds.push(or(
                gt(priceBookItems.name, cursor.name),
                and(eq(priceBookItems.name, cursor.name), gt(priceBookItems.itemId, cursor.id)),
            ));
        }

        // One extra row tells us whether another page exists without a second query.
        const rows = await this.db.select().from(priceBookItems)
            .where(and(...pageConds))
            .orderBy(asc(priceBookItems.name), asc(priceBookItems.itemId))
            .limit(limit + 1);

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page[page.length - 1] as any;

        return {
            items: page.map((r: any) => fromRow<PriceBookItem>(r, NUM)),
            lastEvaluatedKey: hasMore && last ? { name: last.name ?? '', id: last.itemId } : null,
            total: Number((await countPromise)[0]?.c ?? 0),
        };
    }

    async putItem(item: PriceBookItem): Promise<void> {
        const row = toRow(priceBookItems, item as Record<string, any>, 'priceBook');
        await this.db.insert(priceBookItems).values(row as any).onConflictDoUpdate({ target: priceBookItems.itemId, set: row as any });
    }
    async putItems(items: PriceBookItem[]): Promise<void> {
        for (const item of items) await this.putItem(item);
    }
    async deleteItem(orgId: string, itemId: string): Promise<void> {
        await this.db.delete(priceBookItems).where(and(eq(priceBookItems.orgId, orgId), eq(priceBookItems.itemId, itemId)));
    }
    async upsertPriceBookItem(item: PriceBookItem): Promise<void> { await this.putItem(item); }
}
