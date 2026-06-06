import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { sk, orgStageKey } from '../keys';
import { Lead } from './schema';

export class LeadRepo {
    constructor(private ddb: IDdb) {}

    async getLead(orgId: string, userId: string, leadId: string): Promise<Lead | null> {
        const { Item } = await this.ddb.getItem(Tables.LEADS, { orgId, sk: sk(userId, leadId) });
        return (Item as Lead) ?? null;
    }

    async findLeadByIdInOrg(orgId: string, leadId: string): Promise<{ lead: Lead; ownerId: string } | null> {
        const { Items } = await this.ddb.query({
            TableName: Tables.LEADS,
            IndexName: 'LeadIdIndex',
            KeyConditionExpression: 'orgId = :orgId AND leadId = :leadId',
            ExpressionAttributeValues: { ':orgId': orgId, ':leadId': leadId },
            Limit: 1,
        });
        const item = Items?.[0] as Lead | undefined;
        if (!item) return null;
        return { lead: item, ownerId: item.createdBy };
    }

    async listUserLeads(orgId: string, userId: string): Promise<Lead[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.LEADS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `${userId}#` },
        });
        return (Items as Lead[]) ?? [];
    }

    async listAllOrgLeads(orgId: string): Promise<Lead[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.LEADS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return (Items as Lead[]) ?? [];
    }

    async listLeadsByStage(orgId: string, stage: string): Promise<Lead[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.LEADS,
            IndexName: 'StageIndex',
            KeyConditionExpression: 'orgStage = :orgStage',
            ExpressionAttributeValues: { ':orgStage': orgStageKey(orgId, stage) },
        });
        return (Items as Lead[]) ?? [];
    }

    async createLead(orgId: string, userId: string, leadId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        const stage = data.stage ?? 'NEW';
        await this.ddb.put(Tables.LEADS, {
            orgId,
            sk: sk(userId, leadId),
            leadId,
            createdBy: userId,
            stageHistory: [{ id: leadId, stage, changedBy: userId, changedAt: now }],
            ...data,
            stage,
            orgStage: orgStageKey(orgId, stage),
            createdAt: now,
            updatedAt: now,
        });
    }

    async updateLead(orgId: string, userId: string, leadId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = ['#updatedAt = :updatedAt'];
        const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
        const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };

        if (updates.stage) {
            updates.orgStage = orgStageKey(orgId, updates.stage);
        }

        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }

        await this.ddb.update(Tables.LEADS, { orgId, sk: sk(userId, leadId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
}
