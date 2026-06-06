"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RosterEntryRepo = void 0;
const tables_1 = require("../tables");
const keys_1 = require("../keys");
class RosterEntryRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async get(orgId, date, memberId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.SCHEDULING, { orgId, sk: (0, keys_1.rosterEntrySk)(date, memberId) });
        return Item ?? null;
    }
    async listByDateRange(orgId, from, to) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.SCHEDULING,
            KeyConditionExpression: 'orgId = :orgId AND sk BETWEEN :from AND :to',
            ExpressionAttributeValues: {
                ':orgId': orgId,
                ':from': `ROSTER#${from}`,
                ':to': `ROSTER#${to}￿`,
            },
        });
        return Items ?? [];
    }
    async listByDate(orgId, date) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.SCHEDULING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `ROSTER#${date}#` },
        });
        return Items ?? [];
    }
    async create(orgId, rosterId, data) {
        const now = new Date().toISOString();
        await this.ddb.put(tables_1.Tables.SCHEDULING, {
            orgId,
            sk: (0, keys_1.rosterEntrySk)(data.date, data.memberId),
            rosterId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }
    async update(orgId, date, memberId, updates) {
        const sets = ['#updatedAt = :updatedAt'];
        const names = { '#updatedAt': 'updatedAt' };
        const values = { ':updatedAt': new Date().toISOString() };
        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }
        await this.ddb.update(tables_1.Tables.SCHEDULING, { orgId, sk: (0, keys_1.rosterEntrySk)(date, memberId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
    async delete(orgId, date, memberId) {
        await this.ddb.delete(tables_1.Tables.SCHEDULING, { orgId, sk: (0, keys_1.rosterEntrySk)(date, memberId) });
    }
    async batchCreate(orgId, entries) {
        if (entries.length === 0)
            return;
        const now = new Date().toISOString();
        const putRequests = entries.map(entry => ({
            PutRequest: {
                Item: {
                    orgId,
                    sk: (0, keys_1.rosterEntrySk)(entry.date, entry.memberId),
                    ...entry,
                    createdAt: now,
                    updatedAt: now,
                },
            },
        }));
        // DynamoDB batch write max 25 items per request
        for (let i = 0; i < putRequests.length; i += 25) {
            const batch = putRequests.slice(i, i + 25);
            await this.ddb.batchWrite({ [tables_1.Tables.SCHEDULING]: batch });
        }
    }
    async bulkUpdateStatus(orgId, entries, status) {
        const now = new Date().toISOString();
        const transactItems = entries.map(entry => ({
            Update: {
                TableName: tables_1.Tables.SCHEDULING,
                Key: { orgId, sk: (0, keys_1.rosterEntrySk)(entry.date, entry.memberId) },
                UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt',
                ExpressionAttributeNames: { '#status': 'status', '#updatedAt': 'updatedAt' },
                ExpressionAttributeValues: { ':status': status, ':updatedAt': now },
            },
        }));
        // DynamoDB transact write max 100 items per request
        for (let i = 0; i < transactItems.length; i += 100) {
            const batch = transactItems.slice(i, i + 100);
            await this.ddb.transactWrite(batch);
        }
    }
}
exports.RosterEntryRepo = RosterEntryRepo;
//# sourceMappingURL=repo.js.map