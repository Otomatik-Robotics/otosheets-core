import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { InboxCache } from './schema';

export class InboxCacheRepo {
    constructor(private ddb: IDdb) {}

    async getEntry(userId: string, gmailId: string): Promise<InboxCache | null> {
        const { Item } = await this.ddb.getItem(Tables.INBOX_CACHE, { userId, gmailId });
        return (Item as InboxCache) ?? null;
    }

    async listByUser(userId: string, opts?: { limit?: number }): Promise<InboxCache[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.INBOX_CACHE,
            KeyConditionExpression: 'userId = :uid',
            ExpressionAttributeValues: { ':uid': userId },
            ScanIndexForward: false,
            Limit: opts?.limit ?? 100,
        });
        return (Items as InboxCache[]) ?? [];
    }

    async putEntry(data: InboxCache): Promise<void> {
        await this.ddb.put(Tables.INBOX_CACHE, data);
    }

    async deleteEntry(userId: string, gmailId: string): Promise<void> {
        await this.ddb.delete(Tables.INBOX_CACHE, { userId, gmailId });
    }
}
