import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { sk, dateSk } from '../keys';
import { Job } from './schema';
import { PaginatedResult } from '../types';

export class JobRepo {
    constructor(private ddb: IDdb) {}

    async getJob(orgId: string, userId: string, jobId: string): Promise<Job | null> {
        const { Item } = await this.ddb.getItem(Tables.JOBS, { orgId, sk: sk(userId, jobId) });
        return (Item as Job) ?? null;
    }

    async findJobByIdInOrg(orgId: string, jobId: string): Promise<{ job: Job; ownerId: string } | null> {
        const { Items } = await this.ddb.query({
            TableName: Tables.JOBS,
            IndexName: 'JobIdIndex',
            KeyConditionExpression: 'orgId = :orgId AND jobId = :jobId',
            ExpressionAttributeValues: { ':orgId': orgId, ':jobId': jobId },
            Limit: 1,
        });
        const item = Items?.[0] as Job | undefined;
        if (!item) return null;
        return { job: item, ownerId: item.createdBy };
    }

    async listUserJobs(orgId: string, userId: string): Promise<Job[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.JOBS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `${userId}#` },
        });
        return (Items as Job[]) ?? [];
    }

    async listAllOrgJobs(orgId: string): Promise<Job[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.JOBS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return (Items as Job[]) ?? [];
    }

    async listJobsByDate(orgId: string, from: string, to: string): Promise<Job[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.JOBS,
            IndexName: 'DateIndex',
            KeyConditionExpression: 'orgId = :orgId AND scheduledDateSk BETWEEN :from AND :to',
            ExpressionAttributeValues: { ':orgId': orgId, ':from': from, ':to': `${to}￿` },
        });
        return (Items as Job[]) ?? [];
    }

    async listOrgJobsPaginated(params: {
        orgId: string;
        limit?: number;
        exclusiveStartKey?: Record<string, any>;
        status?: string;
        clientId?: string;
        search?: string;
        memberId?: string;
        dateFrom?: string;
        dateTo?: string;
    }): Promise<PaginatedResult<Job>> {
        const { orgId, limit = 20, exclusiveStartKey, status, clientId, search, memberId, dateFrom, dateTo } = params;
        const filterParts: string[] = [];
        const names: Record<string, string> = {};
        const values: Record<string, any> = { ':orgId': orgId };

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
            if (!names['#scheduledDate']) names['#scheduledDate'] = 'scheduledDate';
            filterParts.push('#scheduledDate <= :dateTo');
            values[':dateTo'] = dateTo;
        }

        const result = await this.ddb.query({
            TableName: Tables.JOBS,
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
            items: (result.Items as Job[]) ?? [],
            lastEvaluatedKey: result.LastEvaluatedKey,
        };
    }

    async createJob(orgId: string, userId: string, jobId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.JOBS, {
            orgId,
            sk: sk(userId, jobId),
            jobId,
            createdBy: userId,
            materials: [],
            photos: [],
            ...data,
            scheduledDateSk: data.scheduledDate ? dateSk(data.scheduledDate, jobId) : undefined,
            createdAt: now,
            updatedAt: now,
        });
    }

    async updateJob(orgId: string, userId: string, jobId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = ['#updatedAt = :updatedAt'];
        const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
        const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };

        if (updates.scheduledDate) {
            updates.scheduledDateSk = dateSk(updates.scheduledDate, jobId);
        }

        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }

        await this.ddb.update(Tables.JOBS, { orgId, sk: sk(userId, jobId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }

    async deleteJob(orgId: string, userId: string, jobId: string): Promise<void> {
        await this.ddb.delete(Tables.JOBS, { orgId, sk: sk(userId, jobId) });
    }
}
