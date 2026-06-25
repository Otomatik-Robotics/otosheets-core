import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { PaginatedResult } from '../types';
import { CallRecord, CallRecordStatus } from './schema';

const skOf = (leadId: string, callId: string) => `CALL#${leadId}#${callId}`;

/** Sparse GSI for the retry sweep: PK=retryShard, SK=nextAttemptAt. */
export const RETRY_DUE_INDEX = 'retryDue';
/**
 * Single shard value for the retry GSI. Sole-trader call volume is low, so one
 * partition is ample; bump to a small hashed set if a hot partition ever appears.
 */
export const RETRY_SHARD = 'RETRY';

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
        // An explicit `null` REMOVEs the attribute — required to drop a record out of
        // the sparse `retryDue` GSI (a NULL-typed attribute would still be indexed).
        const removes: string[] = [];
        for (const [k, v] of entries) {
            names[`#${k}`] = k;
            if (v === null) {
                removes.push(`#${k}`);
            } else {
                values[`:${k}`] = v;
                sets.push(`#${k} = :${k}`);
            }
        }
        const expr = `SET ${sets.join(', ')}` + (removes.length ? ` REMOVE ${removes.join(', ')}` : '');
        await this.ddb.update(Tables.CALL_RECORDS, { orgId, sk: skOf(leadId, callId) }, {
            UpdateExpression: expr,
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

    async delete(orgId: string, leadId: string, callId: string): Promise<void> {
        await this.ddb.delete(Tables.CALL_RECORDS, { orgId, sk: skOf(leadId, callId) });
    }

    /**
     * Fixed-window inbound-call counter for spam mitigation. Increments and
     * returns the call count for (callerNumber, current time-window bucket).
     * Each window is a fresh counter keyed by its bucket; the `ttl` attribute
     * auto-expires old buckets so these markers never accumulate. Caller compares
     * the returned count against a threshold to throttle robocallers before they
     * burn AI minutes / text-back SMS.
     */
    async bumpInboundThrottle(
        orgId: string,
        callerNumber: string,
        nowMs: number,
        windowSeconds: number,
    ): Promise<number> {
        const bucket = Math.floor(nowMs / (windowSeconds * 1000));
        const sk = `INBOUND#THROTTLE#${callerNumber}#${bucket}`;
        const ttl = Math.floor(nowMs / 1000) + windowSeconds * 2; // keep one extra window for safety
        const res = await this.ddb.update(Tables.CALL_RECORDS, { orgId, sk }, {
            UpdateExpression:
                'ADD #count :one SET #ttl = if_not_exists(#ttl, :ttl), createdAt = if_not_exists(createdAt, :now)',
            ExpressionAttributeNames: { '#count': 'count', '#ttl': 'ttl' },
            ExpressionAttributeValues: { ':one': 1, ':ttl': ttl, ':now': new Date(nowMs).toISOString() },
            ReturnValues: 'UPDATED_NEW',
        });
        return ((res.Attributes as { count?: number } | undefined)?.count) ?? 1;
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

    /**
     * Retry-pending calls due at or before `nowIso`, across all orgs, oldest-due
     * first. Backed by the sparse `retryDue` GSI — only records awaiting a
     * scheduled retry carry `retryShard`, so this never scans the full table.
     */
    async listDueRetries(nowIso: string, limit = 50): Promise<CallRecord[]> {
        const result = await this.ddb.query({
            TableName: Tables.CALL_RECORDS,
            IndexName: RETRY_DUE_INDEX,
            KeyConditionExpression: 'retryShard = :shard AND nextAttemptAt <= :now',
            ExpressionAttributeValues: { ':shard': RETRY_SHARD, ':now': nowIso },
            ScanIndexForward: true,
            Limit: limit,
        });
        return (result.Items as CallRecord[]) ?? [];
    }
}
