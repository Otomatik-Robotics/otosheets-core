import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { Integration } from './schema';

export class IntegrationRepo {
    constructor(private ddb: IDdb) {}

    async getIntegration(ownerId: string, provider: string): Promise<Integration | null> {
        const { Item } = await this.ddb.getItem(Tables.INTEGRATIONS, { ownerId, provider });
        return (Item as Integration) ?? null;
    }

    async listIntegrations(ownerId: string): Promise<Integration[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.INTEGRATIONS,
            KeyConditionExpression: 'ownerId = :ownerId',
            ExpressionAttributeValues: { ':ownerId': ownerId },
        });
        return (Items as Integration[]) ?? [];
    }

    async putIntegration(ownerId: string, provider: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.INTEGRATIONS, {
            ownerId,
            provider,
            ...data,
            createdAt: data.createdAt ?? now,
            updatedAt: now,
        });
    }

    async deleteIntegration(ownerId: string, provider: string): Promise<void> {
        await this.ddb.delete(Tables.INTEGRATIONS, { ownerId, provider });
    }
}
