"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AvailabilityRuleRepo = void 0;
const tables_1 = require("../tables");
const keys_1 = require("../keys");
class AvailabilityRuleRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async listByMember(orgId, memberId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.SCHEDULING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `AVAIL_RULE#${memberId}#` },
        });
        return Items ?? [];
    }
    async listByOrg(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.SCHEDULING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'AVAIL_RULE#' },
        });
        return Items ?? [];
    }
    async put(orgId, memberId, ruleId, data) {
        const now = new Date().toISOString();
        await this.ddb.put(tables_1.Tables.SCHEDULING, {
            orgId,
            sk: (0, keys_1.availabilityRuleSk)(memberId, ruleId),
            ruleId,
            memberId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }
    async delete(orgId, memberId, ruleId) {
        await this.ddb.delete(tables_1.Tables.SCHEDULING, { orgId, sk: (0, keys_1.availabilityRuleSk)(memberId, ruleId) });
    }
    async deleteAllForMember(orgId, memberId) {
        const existing = await this.listByMember(orgId, memberId);
        if (existing.length === 0)
            return;
        const deleteRequests = existing.map(rule => ({
            DeleteRequest: { Key: { orgId, sk: (0, keys_1.availabilityRuleSk)(memberId, rule.ruleId) } },
        }));
        await this.ddb.batchWrite({ [tables_1.Tables.SCHEDULING]: deleteRequests });
    }
    async replaceAllForMember(orgId, memberId, rules) {
        await this.deleteAllForMember(orgId, memberId);
        const now = new Date().toISOString();
        if (rules.length === 0)
            return;
        const putRequests = rules.map(rule => ({
            PutRequest: {
                Item: {
                    orgId,
                    sk: (0, keys_1.availabilityRuleSk)(memberId, rule.ruleId),
                    memberId,
                    ...rule,
                    createdAt: now,
                    updatedAt: now,
                },
            },
        }));
        await this.ddb.batchWrite({ [tables_1.Tables.SCHEDULING]: putRequests });
    }
}
exports.AvailabilityRuleRepo = AvailabilityRuleRepo;
//# sourceMappingURL=repo.js.map