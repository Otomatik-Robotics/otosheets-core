"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComplianceRepo = void 0;
const tables_1 = require("../tables");
const keys_1 = require("../keys");
class ComplianceRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getPlaybook(orgId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.ONBOARDING, { orgId, sk: (0, keys_1.compliancePlaybookSk)() });
        return Item ?? null;
    }
    async putPlaybook(orgId, tasks, updatedBy) {
        await this.ddb.put(tables_1.Tables.ONBOARDING, {
            orgId,
            sk: (0, keys_1.compliancePlaybookSk)(),
            tasks,
            updatedBy,
            updatedAt: new Date().toISOString(),
        });
    }
    async listTasks(orgId, userId) {
        const prefix = userId ? `TASK#${userId}#` : 'TASK#';
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': prefix },
        });
        return Items ?? [];
    }
    async createTask(orgId, userId, taskId, data) {
        const now = new Date().toISOString();
        await this.ddb.put(tables_1.Tables.ONBOARDING, {
            orgId,
            sk: (0, keys_1.complianceTaskSk)(userId, taskId),
            taskId,
            userId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }
    async updateTask(orgId, userId, taskId, updates) {
        const sets = ['#updatedAt = :updatedAt'];
        const names = { '#updatedAt': 'updatedAt' };
        const values = { ':updatedAt': new Date().toISOString() };
        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }
        await this.ddb.update(tables_1.Tables.ONBOARDING, { orgId, sk: (0, keys_1.complianceTaskSk)(userId, taskId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
}
exports.ComplianceRepo = ComplianceRepo;
//# sourceMappingURL=repo.js.map