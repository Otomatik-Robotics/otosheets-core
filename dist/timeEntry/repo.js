"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimeEntryRepo = void 0;
const tables_1 = require("../tables");
const keys_1 = require("../keys");
class TimeEntryRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getTimeEntry(orgId, userId, timeEntryId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.TIME_ENTRIES, { orgId, sk: (0, keys_1.sk)(userId, timeEntryId) });
        return Item ?? null;
    }
    async findTimeEntryByIdInOrg(orgId, timeEntryId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.TIME_ENTRIES,
            IndexName: 'TimeEntryIdIndex',
            KeyConditionExpression: 'orgId = :orgId AND timeEntryId = :timeEntryId',
            ExpressionAttributeValues: { ':orgId': orgId, ':timeEntryId': timeEntryId },
            Limit: 1,
        });
        const item = Items?.[0];
        if (!item)
            return null;
        return { timeEntry: item, ownerId: item.createdBy };
    }
    async listAllOrgTimeEntries(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.TIME_ENTRIES,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return Items ?? [];
    }
    async listOrgTimeEntriesPaginated(params) {
        const { orgId, limit = 20, exclusiveStartKey, clientId, from, to, uninvoiced, search } = params;
        const filterParts = [];
        const names = {};
        const values = { ':orgId': orgId };
        if (clientId) {
            filterParts.push('#clientId = :clientId');
            names['#clientId'] = 'clientId';
            values[':clientId'] = clientId;
        }
        if (from) {
            filterParts.push('#date >= :from');
            names['#date'] = 'date';
            values[':from'] = from;
        }
        if (to) {
            if (!names['#date'])
                names['#date'] = 'date';
            filterParts.push('#date <= :to');
            values[':to'] = to;
        }
        if (uninvoiced) {
            filterParts.push('attribute_not_exists(invoicedAt)');
        }
        if (search) {
            filterParts.push('(contains(#description, :search) OR contains(#project, :search))');
            names['#description'] = 'description';
            names['#project'] = 'project';
            values[':search'] = search;
        }
        const result = await this.ddb.query({
            TableName: tables_1.Tables.TIME_ENTRIES,
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
    async listTimeEntries(orgId, userId, opts) {
        const params = {
            TableName: tables_1.Tables.TIME_ENTRIES,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `${userId}#` },
        };
        if (opts?.uninvoiced) {
            params.FilterExpression = 'attribute_not_exists(invoicedAt)';
        }
        const { Items } = await this.ddb.query(params);
        return Items ?? [];
    }
    async createTimeEntry(orgId, userId, timeEntryId, data) {
        const now = new Date().toISOString();
        await this.ddb.put(tables_1.Tables.TIME_ENTRIES, {
            orgId,
            sk: (0, keys_1.sk)(userId, timeEntryId),
            timeEntryId,
            createdBy: userId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }
    async updateTimeEntry(orgId, userId, timeEntryId, updates) {
        const sets = ['#updatedAt = :updatedAt'];
        const names = { '#updatedAt': 'updatedAt' };
        const values = { ':updatedAt': new Date().toISOString() };
        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }
        await this.ddb.update(tables_1.Tables.TIME_ENTRIES, { orgId, sk: (0, keys_1.sk)(userId, timeEntryId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
    async deleteTimeEntry(orgId, userId, timeEntryId) {
        await this.ddb.delete(tables_1.Tables.TIME_ENTRIES, { orgId, sk: (0, keys_1.sk)(userId, timeEntryId) });
    }
}
exports.TimeEntryRepo = TimeEntryRepo;
//# sourceMappingURL=repo.js.map