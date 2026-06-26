import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { PriceBookItem } from './schema';

export class PriceBookRepo {
    constructor(private ddb: IDdb) {}

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

    async deleteItem(orgId: string, itemId: string): Promise<void> {
        await this.ddb.delete(Tables.PRICE_BOOK, { orgId, itemId });
    }
}
