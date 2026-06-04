import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { availabilityRuleSk } from '../keys';
import { AvailabilityRule } from './schema';

export class AvailabilityRuleRepo {
    constructor(private ddb: IDdb) {}

    async listByMember(orgId: string, memberId: string): Promise<AvailabilityRule[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.SCHEDULING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `AVAIL_RULE#${memberId}#` },
        });
        return (Items as AvailabilityRule[]) ?? [];
    }

    async listByOrg(orgId: string): Promise<AvailabilityRule[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.SCHEDULING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'AVAIL_RULE#' },
        });
        return (Items as AvailabilityRule[]) ?? [];
    }

    async put(orgId: string, memberId: string, ruleId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.SCHEDULING, {
            orgId,
            sk: availabilityRuleSk(memberId, ruleId),
            ruleId,
            memberId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }

    async delete(orgId: string, memberId: string, ruleId: string): Promise<void> {
        await this.ddb.delete(Tables.SCHEDULING, { orgId, sk: availabilityRuleSk(memberId, ruleId) });
    }

    async deleteAllForMember(orgId: string, memberId: string): Promise<void> {
        const existing = await this.listByMember(orgId, memberId);
        if (existing.length === 0) return;

        const deleteRequests = existing.map(rule => ({
            DeleteRequest: { Key: { orgId, sk: availabilityRuleSk(memberId, rule.ruleId) } },
        }));

        await this.ddb.batchWrite({ [Tables.SCHEDULING]: deleteRequests });
    }

    async replaceAllForMember(orgId: string, memberId: string, rules: Array<{ ruleId: string } & Record<string, any>>): Promise<void> {
        await this.deleteAllForMember(orgId, memberId);
        const now = new Date().toISOString();
        if (rules.length === 0) return;

        const putRequests = rules.map(rule => ({
            PutRequest: {
                Item: {
                    orgId,
                    sk: availabilityRuleSk(memberId, rule.ruleId),
                    memberId,
                    ...rule,
                    createdAt: now,
                    updatedAt: now,
                },
            },
        }));

        await this.ddb.batchWrite({ [Tables.SCHEDULING]: putRequests });
    }
}
