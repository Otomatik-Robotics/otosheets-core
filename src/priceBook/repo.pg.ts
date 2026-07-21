import { and, eq, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { priceBookItems } from '../pg/schema/opsEntities';
import { toRow, fromRow } from '../pg/rows';
import { PriceBookItem } from './schema';
import type { IPriceBookRepo } from './repo';

const NUM = ['unitPrice', 'costPrice', 'qtyOnHand', 'reorderPoint'];

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
