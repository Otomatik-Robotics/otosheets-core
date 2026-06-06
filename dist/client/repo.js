"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientRepo = void 0;
const tables_1 = require("../tables");
class ClientRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getClient(orgId, clientId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.CLIENTS, { orgId, clientId });
        return Item ?? null;
    }
    async listClients(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.CLIENTS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return Items ?? [];
    }
    async listClientsPaginated(params) {
        const { orgId, limit = 20, exclusiveStartKey, search, dateFrom, dateTo } = params;
        const filterParts = [];
        const names = {};
        const values = { ':orgId': orgId };
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
            if (!names['#createdAt'])
                names['#createdAt'] = 'createdAt';
            filterParts.push('#createdAt <= :dateTo');
            values[':dateTo'] = dateTo;
        }
        const result = await this.ddb.query({
            TableName: tables_1.Tables.CLIENTS,
            IndexName: 'CreatedAtIndex',
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: values,
            ...(Object.keys(names).length > 0 && { ExpressionAttributeNames: names }),
            ...(filterParts.length > 0 && { FilterExpression: filterParts.join(' AND ') }),
            ScanIndexForward: false,
            Limit: limit,
            ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
        });
        return {
            items: result.Items ?? [],
            lastEvaluatedKey: result.LastEvaluatedKey,
        };
    }
    async findClientByEmail(orgId, email) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.CLIENTS,
            IndexName: 'CreatedAtIndex',
            KeyConditionExpression: 'orgId = :orgId',
            FilterExpression: '#email = :email',
            ExpressionAttributeNames: { '#email': 'email' },
            ExpressionAttributeValues: { ':orgId': orgId, ':email': email.toLowerCase() },
            Limit: 1,
        });
        return Items?.[0] ?? null;
    }
    async countClients(orgId) {
        const { Count } = await this.ddb.query({
            TableName: tables_1.Tables.CLIENTS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
            Select: 'COUNT',
        });
        return Count ?? 0;
    }
    async listClientEmails(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.CLIENTS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
            ProjectionExpression: 'clientId, email, #name',
            ExpressionAttributeNames: { '#name': 'name' },
        });
        return (Items ?? [])
            .filter(c => c.email)
            .map(c => ({ clientId: c.clientId, email: c.email, name: c.name || '' }));
    }
    async createClient(orgId, clientId, data) {
        const now = new Date().toISOString();
        await this.ddb.put(tables_1.Tables.CLIENTS, {
            orgId,
            clientId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }
    async updateClient(orgId, clientId, updates) {
        const sets = ['#updatedAt = :updatedAt'];
        const names = { '#updatedAt': 'updatedAt' };
        const values = { ':updatedAt': new Date().toISOString() };
        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }
        await this.ddb.update(tables_1.Tables.CLIENTS, { orgId, clientId }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
    async batchGetClients(orgId, clientIds) {
        if (clientIds.length === 0)
            return [];
        const chunks = [];
        for (let i = 0; i < clientIds.length; i += 100) {
            chunks.push(clientIds.slice(i, i + 100));
        }
        const results = [];
        for (const chunk of chunks) {
            const { Responses } = await this.ddb.batchGet({
                [tables_1.Tables.CLIENTS]: { Keys: chunk.map(id => ({ orgId, clientId: id })) },
            });
            if (Responses?.[tables_1.Tables.CLIENTS]) {
                results.push(...Responses[tables_1.Tables.CLIENTS]);
            }
        }
        return results;
    }
    async deleteClient(orgId, clientId) {
        await this.ddb.delete(tables_1.Tables.CLIENTS, { orgId, clientId });
    }
}
exports.ClientRepo = ClientRepo;
//# sourceMappingURL=repo.js.map