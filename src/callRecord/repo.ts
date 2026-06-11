import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { PaginatedResult } from '../types';
import { CallRecord, CallRecordStatus } from './schema';

const skOf = (leadId: string, callId: string) => `CALL#${leadId}#${callId}`;

export class CallRecordRepo {
    constructor(private ddb: IDdb) {}

    async get(orgId: string, leadId: string, callId: string): Promise<CallRecord | null> {
        const { Item } = await this.ddb.getItem(Tables.CALL_RECORDS, { orgId, sk: skOf(leadId, callId) });
        return (Item as CallRecord) ?? null;
    }

    async put(orgId: string, leadId: string, callId: string, data: Partial<CallRecord>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.CALL_RECORDS, {
            orgId,
            sk: skOf(leadId, callId),
            leadId,
            callId,
            ...data,
            createdAt: data.createdAt ?? now,
            updatedAt: now,
        });
    }

    /** Partial update — only the provided fields are set; key fields are never overwritten. */
    async update(orgId: string, leadId: string, callId: string, fields: Partial<CallRecord>): Promise<void> {
        const entries = Object.entries(fields).filter(
            ([k, v]) => v !== undefined && !['orgId', 'sk', 'leadId', 'callId', 'createdAt'].includes(k),
        );
        const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
        const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };
        const sets = ['#updatedAt = :updatedAt'];
        for (const [k, v] of entries) {
            names[`#${k}`] = k;
            values[`:${k}`] = v;
            sets.push(`#${k} = :${k}`);
        }
        await this.ddb.update(Tables.CALL_RECORDS, { orgId, sk: skOf(leadId, callId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }

    /** Calls for one lead, newest first (callId is a ULID — time-ordered). */
    async listByLead(orgId: string, leadId: string, limit = 20): Promise<CallRecord[]> {
        const result = await this.ddb.query({
            TableName: Tables.CALL_RECORDS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `CALL#${leadId}#` },
            ScanIndexForward: false,
            Limit: limit,
        });
        return (result.Items as CallRecord[]) ?? [];
    }

    /** Most recent call for a lead, or null. */
    async latestForLead(orgId: string, leadId: string): Promise<CallRecord | null> {
        const items = await this.listByLead(orgId, leadId, 1);
        return items[0] ?? null;
    }

    async listByOrg(params: {
        orgId: string;
        limit?: number;
        exclusiveStartKey?: Record<string, any>;
        status?: CallRecordStatus;
    }): Promise<PaginatedResult<CallRecord>> {
        const { orgId, limit = 20, exclusiveStartKey, status } = params;
        const result = await this.ddb.query({
            TableName: Tables.CALL_RECORDS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ...(status && { FilterExpression: '#status = :status' }),
            ...(status && { ExpressionAttributeNames: { '#status': 'status' } }),
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'CALL#', ...(status && { ':status': status }) },
            ScanIndexForward: false,
            Limit: limit,
            ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
        });
        return {
            items: (result.Items as CallRecord[]) ?? [],
            lastEvaluatedKey: result.LastEvaluatedKey,
        };
    }

    async countByStatus(orgId: string, status: CallRecordStatus): Promise<number> {
        const { Count } = await this.ddb.query({
            TableName: Tables.CALL_RECORDS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            FilterExpression: '#status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'CALL#', ':status': status },
            Select: 'COUNT',
        });
        return Count ?? 0;
    }
}
