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

/** Sparse GSI for per-number outbound serialization: PK=activeNumberShard, SK=callId (ULID, oldest-first). */
export const ACTIVE_BY_NUMBER_INDEX = 'activeByNumber';
/** Shard value for the active-by-number GSI — one partition per (org, outbound number). */
export const activeNumberShard = (orgId: string, numberId: string) => `${orgId}#${numberId}`;
/** SK prefix for the org-wide "is an inbound call live?" markers (cleared on call end; TTL failsafe). */
export const INBOUND_ACTIVE_PREFIX = 'INBOUND#ACTIVE#';
const inboundActiveSk = (inboundCallId: string) => `${INBOUND_ACTIVE_PREFIX}${inboundCallId}`;
/** Statuses that occupy a number — a call in any of these is "live" on its number. */
const LIVE_STATUSES: CallRecordStatus[] = ['DIALING', 'IN_PROGRESS'];

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
        /** Restrict to one agent's calls (server-side FilterExpression) — backs the per-agent log. */
        agentId?: string;
    }): Promise<PaginatedResult<CallRecord>> {
        const { orgId, limit = 20, exclusiveStartKey, status, agentId } = params;
        const filters: string[] = [];
        const names: Record<string, string> = {};
        const values: Record<string, any> = { ':orgId': orgId, ':prefix': 'CALL#' };
        if (status) { filters.push('#status = :status'); names['#status'] = 'status'; values[':status'] = status; }
        if (agentId) { filters.push('#agentId = :agentId'); names['#agentId'] = 'agentId'; values[':agentId'] = agentId; }
        const result = await this.ddb.query({
            TableName: Tables.CALL_RECORDS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ...(filters.length && { FilterExpression: filters.join(' AND ') }),
            ...(Object.keys(names).length && { ExpressionAttributeNames: names }),
            ExpressionAttributeValues: values,
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

    // ─── Concurrency: per-number outbound serialization ──────────────────────

    /**
     * Live outbound calls on (org, number), oldest-first via the sparse
     * `activeByNumber` GSI. Only QUEUED/DIALING/IN_PROGRESS calls carry the
     * shard marker, so this never scans. Used by the dial-admission gate and the
     * release-kick. `limit` bounds the read (2 is enough to answer "am I head?").
     */
    async listActiveByNumber(orgId: string, numberId: string, limit = 10): Promise<CallRecord[]> {
        const result = await this.ddb.query({
            TableName: Tables.CALL_RECORDS,
            IndexName: ACTIVE_BY_NUMBER_INDEX,
            KeyConditionExpression: 'activeNumberShard = :shard',
            ExpressionAttributeValues: { ':shard': activeNumberShard(orgId, numberId) },
            ScanIndexForward: true, // ULID asc = oldest queued first
            Limit: limit,
        });
        return (result.Items as CallRecord[]) ?? [];
    }

    /** True when a call on this number is already DIALING/IN_PROGRESS (the number is busy). */
    async hasActiveDialingByNumber(orgId: string, numberId: string): Promise<boolean> {
        const items = await this.listActiveByNumber(orgId, numberId, 25);
        return items.some((c) => LIVE_STATUSES.includes(c.status));
    }

    /** Head (oldest) QUEUED call on this number, or null — the next one allowed to dial. */
    async headQueuedByNumber(orgId: string, numberId: string): Promise<CallRecord | null> {
        const items = await this.listActiveByNumber(orgId, numberId, 25);
        return items.find((c) => c.status === 'QUEUED') ?? null;
    }

    /**
     * Atomically claim a QUEUED call for dialing (QUEUED → DIALING) via a
     * conditional update. Returns true if this caller won the claim, false if the
     * status was no longer QUEUED (a concurrent consumer already took it, or it was
     * cancelled). This conditional flip is the mutual-exclusion latch that makes
     * per-number serialization correct even on a non-FIFO dial queue.
     */
    async tryClaimForDial(orgId: string, leadId: string, callId: string): Promise<boolean> {
        try {
            await this.ddb.update(Tables.CALL_RECORDS, { orgId, sk: skOf(leadId, callId) }, {
                UpdateExpression: 'SET #status = :dialing, #updatedAt = :now',
                ConditionExpression: '#status = :queued',
                ExpressionAttributeNames: { '#status': 'status', '#updatedAt': 'updatedAt' },
                ExpressionAttributeValues: { ':dialing': 'DIALING', ':queued': 'QUEUED', ':now': new Date().toISOString() },
            });
            return true;
        } catch (err: any) {
            if (err?.name === 'ConditionalCheckFailedException' || err?.code === 'ConditionalCheckFailedException') return false;
            throw err;
        }
    }

    // ─── Concurrency: org-wide inbound-active markers ────────────────────────

    /** Any live inbound call for this org (single-partition query, no GSI), or null. */
    async getActiveInboundForOrg(orgId: string): Promise<CallRecord | null> {
        const result = await this.ddb.query({
            TableName: Tables.CALL_RECORDS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': INBOUND_ACTIVE_PREFIX },
            Limit: 1,
        });
        return ((result.Items as CallRecord[]) ?? [])[0] ?? null;
    }

    /**
     * Mark an inbound call live. `ttlSeconds` sets a failsafe auto-clear (telephony
     * end webhooks aren't guaranteed; a stuck marker must never wedge outbound forever).
     */
    async putInboundActive(
        orgId: string,
        inboundCallId: string,
        data: { callerNumber?: string | null; agentId?: string | null; twilioCallSid?: string | null; status?: string; ttlSeconds?: number },
    ): Promise<void> {
        const now = Date.now();
        const ttlSeconds = data.ttlSeconds ?? 3600;
        await this.ddb.put(Tables.CALL_RECORDS, {
            orgId,
            sk: inboundActiveSk(inboundCallId),
            direction: 'inbound',
            status: data.status ?? 'IN_PROGRESS',
            callerNumber: data.callerNumber ?? null,
            agentId: data.agentId ?? null,
            twilioCallSid: data.twilioCallSid ?? null,
            ttl: Math.floor(now / 1000) + ttlSeconds,
            createdAt: new Date(now).toISOString(),
            updatedAt: new Date(now).toISOString(),
        });
    }

    /** Clear an inbound-active marker (idempotent — no-op if already gone). */
    async clearInboundActive(orgId: string, inboundCallId: string): Promise<void> {
        await this.ddb.delete(Tables.CALL_RECORDS, { orgId, sk: inboundActiveSk(inboundCallId) });
    }

    /**
     * Attach the lead the in-call AI just captured to this org's live inbound
     * marker, so the inbound end-of-call report can link the saved call-history
     * record back to that lead. Best-effort and idempotent — overwrites with the
     * latest capture; a no-op when no inbound call is currently marked live (e.g.
     * the marker already expired, or the call came in without one).
     */
    async markInboundCapturedLead(orgId: string, leadId: string, pipelineId?: string | null): Promise<void> {
        const marker = await this.getActiveInboundForOrg(orgId);
        if (!marker?.sk) return;
        await this.ddb.update(Tables.CALL_RECORDS, { orgId, sk: marker.sk }, {
            UpdateExpression: 'SET #capturedLeadId = :leadId, #capturedPipelineId = :pipelineId, #updatedAt = :now',
            ExpressionAttributeNames: {
                '#capturedLeadId': 'capturedLeadId',
                '#capturedPipelineId': 'capturedPipelineId',
                '#updatedAt': 'updatedAt',
            },
            ExpressionAttributeValues: {
                ':leadId': leadId,
                ':pipelineId': pipelineId ?? null,
                ':now': new Date().toISOString(),
            },
        });
    }
}
