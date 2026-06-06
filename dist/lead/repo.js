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
    async listOrgLeadsPaginated(params) {
        const { orgId, limit = 20, exclusiveStartKey, stage, source, search } = params;
        const filterParts = [];
        const names = {};
        const values = { ':orgId': orgId };
        if (stage) {
            filterParts.push('#stage = :stage');
            names['#stage'] = 'stage';
            values[':stage'] = stage;
        }
        if (source) {
            filterParts.push('#source = :source');
            names['#source'] = 'source';
            values[':source'] = source;
        }
        if (search) {
            filterParts.push('(contains(#clientName, :search) OR contains(#clientEmail, :search) OR contains(#suburb, :search))');
            names['#clientName'] = 'clientName';
            names['#clientEmail'] = 'clientEmail';
            names['#suburb'] = 'suburb';
            values[':search'] = search;
        }
        const result = await this.ddb.query({
            TableName: tables_1.Tables.LEADS,
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
    async findActiveLeadBySenderId(orgId, senderId) {
        const terminalStages = ['COMPLETE', 'LOST'];
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.LEADS,
            IndexName: 'CreatedAtIndex',
            KeyConditionExpression: 'orgId = :orgId',
            FilterExpression: '#senderId = :senderId AND NOT #stage IN (:s1, :s2)',
            ExpressionAttributeNames: { '#senderId': 'senderId', '#stage': 'stage' },
            ExpressionAttributeValues: {
                ':orgId': orgId,
                ':senderId': senderId,
                ':s1': terminalStages[0],
                ':s2': terminalStages[1],
            },
            ScanIndexForward: false,
            Limit: 1,
        });
        return Items?.[0] ?? null;
    }
    async countOrgLeads(orgId) {
        const { Count } = await this.ddb.query({
            TableName: tables_1.Tables.LEADS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
            Select: 'COUNT',
        });
        return Count ?? 0;
    }
    async listRecentLeads(orgId, since) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.LEADS,
            IndexName: 'CreatedAtIndex',
            KeyConditionExpression: 'orgId = :orgId AND createdAt >= :since',
            ExpressionAttributeValues: { ':orgId': orgId, ':since': since },
            ScanIndexForward: false,
        });
        return Items ?? [];
    }
    async findLeadsByPipelineId(orgId, pipelineId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.LEADS,
            IndexName: 'CreatedAtIndex',
            KeyConditionExpression: 'orgId = :orgId',
            FilterExpression: '#pipelineId = :pipelineId',
            ExpressionAttributeNames: { '#pipelineId': 'pipelineId' },
            ExpressionAttributeValues: { ':orgId': orgId, ':pipelineId': pipelineId },
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