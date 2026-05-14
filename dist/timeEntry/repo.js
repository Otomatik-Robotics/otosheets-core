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
    async listAllOrgTimeEntries(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.TIME_ENTRIES,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return Items ?? [];
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