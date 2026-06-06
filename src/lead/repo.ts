import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { sk, orgStageKey } from '../keys';
import { Lead } from './schema';
import { PaginatedResult } from '../types';

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

    async listOrgLeadsPaginated(params: {
        orgId: string;
        limit?: number;
        exclusiveStartKey?: Record<string, any>;
        stage?: string;
        source?: string;
        search?: string;
    }): Promise<PaginatedResult<Lead>> {
        const { orgId, limit = 20, exclusiveStartKey, stage, source, search } = params;
        const filterParts: string[] = [];
        const names: Record<string, string> = {};
        const values: Record<string, any> = { ':orgId': orgId };

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
            TableName: Tables.LEADS,
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
            items: (result.Items as Lead[]) ?? [],
            lastEvaluatedKey: result.LastEvaluatedKey,
        };
    }

    async findActiveLeadBySenderId(orgId: string, senderId: string): Promise<Lead | null> {
        const terminalStages = ['COMPLETE', 'LOST'];
        const { Items } = await this.ddb.query({
            TableName: Tables.LEADS,
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
        return (Items?.[0] as Lead) ?? null;
    }

    async countOrgLeads(orgId: string): Promise<number> {
        const { Count } = await this.ddb.query({
            TableName: Tables.LEADS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
            Select: 'COUNT',
        });
        return Count ?? 0;
    }

    async listRecentLeads(orgId: string, since: string): Promise<Lead[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.LEADS,
            IndexName: 'CreatedAtIndex',
            KeyConditionExpression: 'orgId = :orgId AND createdAt >= :since',
            ExpressionAttributeValues: { ':orgId': orgId, ':since': since },
            ScanIndexForward: false,
        });
        return (Items as Lead[]) ?? [];
    }

    async findLeadsByPipelineId(orgId: string, pipelineId: string): Promise<Lead[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.LEADS,
            IndexName: 'CreatedAtIndex',
            KeyConditionExpression: 'orgId = :orgId',
            FilterExpression: '#pipelineId = :pipelineId',
            ExpressionAttributeNames: { '#pipelineId': 'pipelineId' },
            ExpressionAttributeValues: { ':orgId': orgId, ':pipelineId': pipelineId },
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
