import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { Client } from './schema';
import { PaginatedResult } from '../types';

export class ClientRepo {
    constructor(private ddb: IDdb) {}

    async getClient(orgId: string, clientId: string): Promise<Client | null> {
        const { Item } = await this.ddb.getItem(Tables.CLIENTS, { orgId, clientId });
        return (Item as Client) ?? null;
    }

    async listClients(orgId: string): Promise<Client[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.CLIENTS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return (Items as Client[]) ?? [];
    }

    async listClientsPaginated(params: {
        orgId: string;
        limit?: number;
        exclusiveStartKey?: Record<string, any>;
        search?: string;
        dateFrom?: string;
        dateTo?: string;
    }): Promise<PaginatedResult<Client>> {
        const { orgId, limit = 20, exclusiveStartKey, search, dateFrom, dateTo } = params;

        const filterParts: string[] = [];
        const names: Record<string, string> = {};
        const values: Record<string, any> = { ':orgId': orgId };

        if (search) {
            filterParts.push('(contains(#name, :search) OR contains(#email, :search) OR contains(#abn, :search))');
            names['#name'] = 'name';
            names['#email'] = 'email';
            names['#abn'] = 'abn';
            values[':search'] = search;
        }
        if (dateFrom) {
            filterParts.push('#createdAt >= :dateFrom');
            names['#createdAt'] = 'createdAt';
            values[':dateFrom'] = dateFrom;
        }
        if (dateTo) {
            if (!names['#createdAt']) names['#createdAt'] = 'createdAt';
            filterParts.push('#createdAt <= :dateTo');
            values[':dateTo'] = dateTo;
        }

        // When searching, scan more items so FilterExpression has enough to work with —
        // DynamoDB applies Limit before FilterExpression, so a tight limit silently misses matches.
        const scanLimit = search ? Math.max(limit, 500) : limit;

        const result = await this.ddb.query({
            TableName: Tables.CLIENTS,
            IndexName: 'CreatedAtIndex',
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: values,
            ...(Object.keys(names).length > 0 && { ExpressionAttributeNames: names }),
            ...(filterParts.length > 0 && { FilterExpression: filterParts.join(' AND ') }),
            ScanIndexForward: false,
            Limit: scanLimit,
            ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
        });

        return {
            items: (result.Items as Client[]) ?? [],
            lastEvaluatedKey: result.LastEvaluatedKey,
        };
    }

    async findClientByEmail(orgId: string, email: string): Promise<Client | null> {
        const { Items } = await this.ddb.query({
            TableName: Tables.CLIENTS,
            IndexName: 'CreatedAtIndex',
            KeyConditionExpression: 'orgId = :orgId',
            FilterExpression: '#email = :email',
            ExpressionAttributeNames: { '#email': 'email' },
            ExpressionAttributeValues: { ':orgId': orgId, ':email': email.toLowerCase() },
            Limit: 1,
        });
        return (Items?.[0] as Client) ?? null;
    }

    async countClients(orgId: string): Promise<number> {
        const { Count } = await this.ddb.query({
            TableName: Tables.CLIENTS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
            Select: 'COUNT',
        });
        return Count ?? 0;
    }

    async listClientEmails(orgId: string): Promise<Array<{ clientId: string; email: string; name: string }>> {
        const { Items } = await this.ddb.query({
            TableName: Tables.CLIENTS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
            ProjectionExpression: 'clientId, email, #name',
            ExpressionAttributeNames: { '#name': 'name' },
        });
        return ((Items as any[]) ?? [])
            .filter(c => c.email)
            .map(c => ({ clientId: c.clientId, email: c.email, name: c.name || '' }));
    }

    async createClient(orgId: string, clientId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.CLIENTS, {
            orgId,
            clientId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }

    async updateClient(orgId: string, clientId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = ['#updatedAt = :updatedAt'];
        const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
        const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };

        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }

        await this.ddb.update(Tables.CLIENTS, { orgId, clientId }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }

    async batchGetClients(orgId: string, clientIds: string[]): Promise<Client[]> {
        if (clientIds.length === 0) return [];
        const chunks: string[][] = [];
        for (let i = 0; i < clientIds.length; i += 100) {
            chunks.push(clientIds.slice(i, i + 100));
        }
        const results: Client[] = [];
        for (const chunk of chunks) {
            const { Responses } = await this.ddb.batchGet({
                [Tables.CLIENTS]: { Keys: chunk.map(id => ({ orgId, clientId: id })) },
            });
            if (Responses?.[Tables.CLIENTS]) {
                results.push(...(Responses[Tables.CLIENTS] as Client[]));
            }
        }
        return results;
    }

    async deleteClient(orgId: string, clientId: string): Promise<void> {
        await this.ddb.delete(Tables.CLIENTS, { orgId, clientId });
    }

    async incrementPaymentLinkUsage(orgId: string, clientId: string): Promise<void> {
        await this.ddb.update(Tables.CLIENTS, { orgId, clientId }, {
            UpdateExpression: 'ADD paymentLinkUsageCount :inc',
            ExpressionAttributeValues: { ':inc': 1 },
        });
    }

    async getTopByUsage(orgId: string, limit = 3): Promise<Client[]> {
        const result = await this.ddb.query({
            TableName: Tables.CLIENTS,
            IndexName: 'UsageCountIndex',
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
            ScanIndexForward: false,
            Limit: limit,
        });
        return (result.Items as Client[]) ?? [];
    }
}
