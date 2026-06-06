"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeadRepo = void 0;
const tables_1 = require("../tables");
const keys_1 = require("../keys");
class LeadRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getLead(orgId, userId, leadId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.LEADS, { orgId, sk: (0, keys_1.sk)(userId, leadId) });
        return Item ?? null;
    }
    async findLeadByIdInOrg(orgId, leadId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.LEADS,
            IndexName: 'LeadIdIndex',
            KeyConditionExpression: 'orgId = :orgId AND leadId = :leadId',
            ExpressionAttributeValues: { ':orgId': orgId, ':leadId': leadId },
            Limit: 1,
        });
        const item = Items?.[0];
        if (!item)
            return null;
        return { lead: item, ownerId: item.createdBy };
    }
    async listUserLeads(orgId, userId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.LEADS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `${userId}#` },
        });
        return Items ?? [];
    }
    async listAllOrgLeads(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.LEADS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return Items ?? [];
    }
    async listLeadsByStage(orgId, stage) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.LEADS,
            IndexName: 'StageIndex',
            KeyConditionExpression: 'orgStage = :orgStage',
            ExpressionAttributeValues: { ':orgStage': (0, keys_1.orgStageKey)(orgId, stage) },
        });
        return Items ?? [];
    }
    async createLead(orgId, userId, leadId, data) {
        const now = new Date().toISOString();
        const stage = data.stage ?? 'NEW';
        await this.ddb.put(tables_1.Tables.LEADS, {
            orgId,
            sk: (0, keys_1.sk)(userId, leadId),
            leadId,
            createdBy: userId,
            stageHistory: [{ id: leadId, stage, changedBy: userId, changedAt: now }],
            ...data,
            stage,
            orgStage: (0, keys_1.orgStageKey)(orgId, stage),
            createdAt: now,
            updatedAt: now,
        });
    }
    async updateLead(orgId, userId, leadId, updates) {
        const sets = ['#updatedAt = :updatedAt'];
        const names = { '#updatedAt': 'updatedAt' };
        const values = { ':updatedAt': new Date().toISOString() };
        if (updates.stage) {
            updates.orgStage = (0, keys_1.orgStageKey)(orgId, updates.stage);
        }
        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }
        await this.ddb.update(tables_1.Tables.LEADS, { orgId, sk: (0, keys_1.sk)(userId, leadId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
}
exports.LeadRepo = LeadRepo;
//# sourceMappingURL=repo.js.map