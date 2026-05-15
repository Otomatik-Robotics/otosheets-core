import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { ShareToken } from './schema';

export class ShareTokenRepo {
    constructor(private ddb: IDdb) {}

    async getToken(token: string): Promise<ShareToken | null> {
        const { Item } = await this.ddb.getItem(Tables.SHARE_TOKENS, { token });
        return (Item as ShareToken) ?? null;
    }

    async listByUser(userId: string): Promise<ShareToken[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.SHARE_TOKENS,
            IndexName: 'UserIndex',
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: { ':userId': userId },
        });
        return (Items as ShareToken[]) ?? [];
    }

    async createToken(data: ShareToken): Promise<void> {
        await this.ddb.put(Tables.SHARE_TOKENS, data);
    }

    async incrementAccessCount(token: string): Promise<void> {
        await this.ddb.update(Tables.SHARE_TOKENS, { token }, {
            UpdateExpression: 'SET accessCount = accessCount + :one',
            ExpressionAttributeValues: { ':one': 1 },
        });
    }

    async deleteToken(token: string): Promise<void> {
        await this.ddb.delete(Tables.SHARE_TOKENS, { token });
    }
}
