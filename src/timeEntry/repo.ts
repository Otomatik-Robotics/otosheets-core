import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { sk } from '../keys';
import { TimeEntry } from './schema';
import { PaginatedResult } from '../types';

export class TimeEntryRepo {
    constructor(private ddb: IDdb) {}

    async getTimeEntry(orgId: string, userId: string, timeEntryId: string): Promise<TimeEntry | null> {
        const { Item } = await this.ddb.getItem(Tables.TIME_ENTRIES, { orgId, sk: sk(userId, timeEntryId) });
        return (Item as TimeEntry) ?? null;
    }

    async findTimeEntryByIdInOrg(orgId: string, timeEntryId: string): Promise<{ timeEntry: TimeEntry; ownerId: string } | null> {
        const { Items } = await this.ddb.query({
            TableName: Tables.TIME_ENTRIES,
            IndexName: 'TimeEntryIdIndex',
            KeyConditionExpression: 'orgId = :orgId AND timeEntryId = :timeEntryId',
            ExpressionAttributeValues: { ':orgId': orgId, ':timeEntryId': timeEntryId },
            Limit: 1,
        });
        const item = Items?.[0] as TimeEntry | undefined;
        if (!item) return null;
        return { timeEntry: item, ownerId: item.createdBy };
    }

    async listAllOrgTimeEntries(orgId: string): Promise<TimeEntry[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.TIME_ENTRIES,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return (Items as TimeEntry[]) ?? [];
    }

    async listOrgTimeEntriesPaginated(params: {
        orgId: string;
        limit?: number;
        exclusiveStartKey?: Record<string, any>;
        clientId?: string;
        from?: string;
        to?: string;
        uninvoiced?: boolean;
    }): Promise<PaginatedResult<TimeEntry>> {
        const { orgId, limit = 20, exclusiveStartKey, clientId, from, to, uninvoiced } = params;
        const filterParts: string[] = [];
        const names: Record<string, string> = {};
        const values: Record<string, any> = { ':orgId': orgId };

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
            if (!names['#date']) names['#date'] = 'date';
            filterParts.push('#date <= :to');
            values[':to'] = to;
        }
        if (uninvoiced) {
            filterParts.push('attribute_not_exists(invoicedAt)');
        }

        const result = await this.ddb.query({
            TableName: Tables.TIME_ENTRIES,
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
            items: (result.Items as TimeEntry[]) ?? [],
            lastEvaluatedKey: result.LastEvaluatedKey,
        };
    }

    async listTimeEntries(orgId: string, userId: string, opts?: { uninvoiced?: boolean }): Promise<TimeEntry[]> {
        const params: any = {
            TableName: Tables.TIME_ENTRIES,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `${userId}#` },
        };
        if (opts?.uninvoiced) {
            params.FilterExpression = 'attribute_not_exists(invoicedAt)';
        }
        const { Items } = await this.ddb.query(params);
        return (Items as TimeEntry[]) ?? [];
    }

    async createTimeEntry(orgId: string, userId: string, timeEntryId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.TIME_ENTRIES, {
            orgId,
            sk: sk(userId, timeEntryId),
            timeEntryId,
            createdBy: userId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }

    async updateTimeEntry(orgId: string, userId: string, timeEntryId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = ['#updatedAt = :updatedAt'];
        const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
        const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };

        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }

        await this.ddb.update(Tables.TIME_ENTRIES, { orgId, sk: sk(userId, timeEntryId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }

    async deleteTimeEntry(orgId: string, userId: string, timeEntryId: string): Promise<void> {
        await this.ddb.delete(Tables.TIME_ENTRIES, { orgId, sk: sk(userId, timeEntryId) });
    }
}
