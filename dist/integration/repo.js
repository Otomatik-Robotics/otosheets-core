"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationRepo = void 0;
const tables_1 = require("../tables");
class IntegrationRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getIntegration(ownerId, provider) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.INTEGRATIONS, { ownerId, provider });
        return Item ?? null;
    }
    async listIntegrations(ownerId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.INTEGRATIONS,
            KeyConditionExpression: 'ownerId = :ownerId',
            ExpressionAttributeValues: { ':ownerId': ownerId },
        });
        return Items ?? [];
    }
    async putIntegration(ownerId, provider, data) {
        const now = new Date().toISOString();
        await this.ddb.put(tables_1.Tables.INTEGRATIONS, {
            ownerId,
            provider,
            ...data,
            createdAt: data.createdAt ?? now,
            updatedAt: now,
        });
    }
    async deleteIntegration(ownerId, provider) {
        await this.ddb.delete(tables_1.Tables.INTEGRATIONS, { ownerId, provider });
    }
}
exports.IntegrationRepo = IntegrationRepo;
//# sourceMappingURL=repo.js.map