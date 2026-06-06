"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MembershipRepo = void 0;
const tables_1 = require("../tables");
class MembershipRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getMembership(orgId, userId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.MEMBERSHIPS, { orgId, userId });
        return Item ?? null;
    }
    async listOrgMembers(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.MEMBERSHIPS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return Items ?? [];
    }
    async listUserOrgs(userId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.MEMBERSHIPS,
            IndexName: 'UserOrgsIndex',
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: { ':userId': userId },
        });
        return Items ?? [];
    }
    async getByInviteToken(token) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.MEMBERSHIPS,
            IndexName: 'InviteTokenIndex',
            KeyConditionExpression: 'inviteToken = :token',
            ExpressionAttributeValues: { ':token': token },
            Limit: 1,
        });
        return Items?.[0] ?? null;
    }
    async createMembership(orgId, userId, data) {
        const now = new Date().toISOString();
        await this.ddb.put(tables_1.Tables.MEMBERSHIPS, {
            orgId,
            userId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }
    async updateMembership(orgId, userId, updates) {
        const sets = ['#updatedAt = :updatedAt'];
        const names = { '#updatedAt': 'updatedAt' };
        const values = { ':updatedAt': new Date().toISOString() };
        for (const [key, val] of Object.entries(updates)) {
            const attr = `#${key}`;
            const placeholder = `:${key}`;
            sets.push(`${attr} = ${placeholder}`);
            names[attr] = key;
            values[placeholder] = val;
        }
        await this.ddb.update(tables_1.Tables.MEMBERSHIPS, { orgId, userId }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
    async deleteMembership(orgId, userId) {
        await this.ddb.delete(tables_1.Tables.MEMBERSHIPS, { orgId, userId });
    }
}
exports.MembershipRepo = MembershipRepo;
//# sourceMappingURL=repo.js.map