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
    async deleteClient(orgId, clientId) {
        await this.ddb.delete(tables_1.Tables.CLIENTS, { orgId, clientId });
    }
}
exports.ClientRepo = ClientRepo;
//# sourceMappingURL=repo.js.map