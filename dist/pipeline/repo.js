"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelineRepo = void 0;
const tables_1 = require("../tables");
class PipelineRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getPipeline(orgId, pipelineId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.PIPELINES, { orgId, pipelineId });
        return Item ?? null;
    }
    async listPipelines(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.PIPELINES,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return Items ?? [];
    }
    async getDefaultPipeline(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.PIPELINES,
            KeyConditionExpression: 'orgId = :orgId',
            FilterExpression: 'isDefault = :t',
            ExpressionAttributeValues: { ':orgId': orgId, ':t': true },
        });
        return Items?.[0] ?? null;
    }
    async createPipeline(orgId, pipelineId, data) {
        const now = new Date().toISOString();
        await this.ddb.put(tables_1.Tables.PIPELINES, {
            orgId,
            pipelineId,
            sources: [],
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }
    async updatePipeline(orgId, pipelineId, updates) {
        const sets = ['#updatedAt = :updatedAt'];
        const names = { '#updatedAt': 'updatedAt' };
        const values = { ':updatedAt': new Date().toISOString() };
        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }
        await this.ddb.update(tables_1.Tables.PIPELINES, { orgId, pipelineId }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
    async deletePipeline(orgId, pipelineId) {
        await this.ddb.delete(tables_1.Tables.PIPELINES, { orgId, pipelineId });
    }
}
exports.PipelineRepo = PipelineRepo;
//# sourceMappingURL=repo.js.map