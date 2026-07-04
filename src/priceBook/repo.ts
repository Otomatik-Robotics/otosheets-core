import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { PriceBookItem } from './schema';

/** Store-agnostic contract — PriceBookDynamoRepo + PriceBookPgRepo; PriceBookRepo (factory) routes. */
export interface IPriceBookRepo {
    getItem(orgId: string, itemId: string): Promise<PriceBookItem | null>;
    listItems(orgId: string): Promise<PriceBookItem[]>;
    putItem(item: PriceBookItem): Promise<void>;
    putItems(items: PriceBookItem[]): Promise<void>;
    deleteItem(orgId: string, itemId: string): Promise<void>;
    upsertPriceBookItem(item: PriceBookItem): Promise<void>;
}

export class PriceBookDynamoRepo implements IPriceBookRepo {
    constructor(private ddb: IDdb) {}

    async upsertPriceBookItem(item: PriceBookItem): Promise<void> {
        await this.ddb.put(Tables.PRICE_BOOK, item);
    }

    async getItem(orgId: string, itemId: string): Promise<PriceBookItem | null> {
        const { Item } = await this.ddb.getItem(Tables.PRICE_BOOK, { orgId, itemId });
        return (Item as PriceBookItem) ?? null;
    }

    async listItems(orgId: string): Promise<PriceBookItem[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.PRICE_BOOK,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return (Items as PriceBookItem[]) ?? [];
    }

    async putItem(item: PriceBookItem): Promise<void> {
        await this.ddb.put(Tables.PRICE_BOOK, item);
    }

    /** Batch-write items in chunks of 25 (DynamoDB BatchWriteItem limit). */
    async putItems(items: PriceBookItem[]): Promise<void> {
        for (let i = 0; i < items.length; i += 25) {
            const chunk = items.slice(i, i + 25);
            const putRequests = chunk.map(item => ({ PutRequest: { Item: item } }));
            await this.ddb.batchWrite({ [Tables.PRICE_BOOK]: putRequests });
        }
    }

    async deleteItem(orgId: string, itemId: string): Promise<void> {
        await this.ddb.delete(Tables.PRICE_BOOK, { orgId, itemId });
    }
}
