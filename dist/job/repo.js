"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobRepo = void 0;
const tables_1 = require("../tables");
const keys_1 = require("../keys");
class JobRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getJob(orgId, userId, jobId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.JOBS, { orgId, sk: (0, keys_1.sk)(userId, jobId) });
        return Item ?? null;
    }
    async findJobByIdInOrg(orgId, jobId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.JOBS,
            IndexName: 'JobIdIndex',
            KeyConditionExpression: 'orgId = :orgId AND jobId = :jobId',
            ExpressionAttributeValues: { ':orgId': orgId, ':jobId': jobId },
            Limit: 1,
        });
        const item = Items?.[0];
        if (!item)
            return null;
        return { job: item, ownerId: item.createdBy };
    }
    async listUserJobs(orgId, userId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.JOBS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `${userId}#` },
        });
        return Items ?? [];
    }
    async listAllOrgJobs(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.JOBS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return Items ?? [];
    }
    async listJobsByDate(orgId, from, to) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.JOBS,
            IndexName: 'DateIndex',
            KeyConditionExpression: 'orgId = :orgId AND scheduledDateSk BETWEEN :from AND :to',
            ExpressionAttributeValues: { ':orgId': orgId, ':from': from, ':to': `${to}￿` },
        });
        return Items ?? [];
    }
    async listOrgJobsPaginated(params) {
        const { orgId, limit = 20, exclusiveStartKey, status, clientId, search, memberId, dateFrom, dateTo } = params;
        const filterParts = [];
        const names = {};
        const values = { ':orgId': orgId };
        if (status) {
            filterParts.push('#status = :status');
            names['#status'] = 'status';
            values[':status'] = status;
        }
        if (clientId) {
            filterParts.push('#clientId = :clientId');
            names['#clientId'] = 'clientId';
            values[':clientId'] = clientId;
        }
        if (search) {
            filterParts.push('(contains(#title, :search) OR contains(#address, :search))');
            names['#title'] = 'title';
            names['#address'] = 'address';
            values[':search'] = search;
        }
        if (memberId) {
            filterParts.push('contains(#assignedMembers, :memberId)');
            names['#assignedMembers'] = 'assignedMembers';
            values[':memberId'] = memberId;
        }
        if (dateFrom) {
            filterParts.push('#scheduledDate >= :dateFrom');
            names['#scheduledDate'] = 'scheduledDate';
            values[':dateFrom'] = dateFrom;
        }
        if (dateTo) {
            if (!names['#scheduledDate'])
                names['#scheduledDate'] = 'scheduledDate';
            filterParts.push('#scheduledDate <= :dateTo');
            values[':dateTo'] = dateTo;
        }
        const result = await this.ddb.query({
            TableName: tables_1.Tables.JOBS,
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
    async createJob(orgId, userId, jobId, data) {
        const now = new Date().toISOString();
        await this.ddb.put(tables_1.Tables.JOBS, {
            orgId,
            sk: (0, keys_1.sk)(userId, jobId),
            jobId,
            createdBy: userId,
            materials: [],
            photos: [],
            ...data,
            scheduledDateSk: data.scheduledDate ? (0, keys_1.dateSk)(data.scheduledDate, jobId) : undefined,
            createdAt: now,
            updatedAt: now,
        });
    }
    async updateJob(orgId, userId, jobId, updates) {
        const sets = ['#updatedAt = :updatedAt'];
        const names = { '#updatedAt': 'updatedAt' };
        const values = { ':updatedAt': new Date().toISOString() };
        if (updates.scheduledDate) {
            updates.scheduledDateSk = (0, keys_1.dateSk)(updates.scheduledDate, jobId);
        }
        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }
        await this.ddb.update(tables_1.Tables.JOBS, { orgId, sk: (0, keys_1.sk)(userId, jobId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
    async deleteJob(orgId, userId, jobId) {
        await this.ddb.delete(tables_1.Tables.JOBS, { orgId, sk: (0, keys_1.sk)(userId, jobId) });
    }
}
exports.JobRepo = JobRepo;
//# sourceMappingURL=repo.js.map