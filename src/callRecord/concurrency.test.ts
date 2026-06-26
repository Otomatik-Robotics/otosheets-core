import { describe, it, expect, beforeEach } from 'vitest';
import { CallRecordRepo } from './repo';
import type { IDdb } from '../ddbPort';

/**
 * In-memory IDdb stub covering the surfaces the concurrency methods use:
 * the `activeByNumber` GSI, conditional updates (the QUEUED→DIALING latch),
 * null→REMOVE, and the org-partition begins_with query for inbound markers.
 */
function makeStubDdb() {
    const store = new Map<string, any>();
    const keyOf = (item: any) => `${item.orgId}|${item.sk}`;

    class ConditionalCheckFailedException extends Error {
        name = 'ConditionalCheckFailedException';
    }

    const ddb = {
        async getItem(_t: string, key: any) {
            return { Item: store.get(`${key.orgId}|${key.sk}`) };
        },
        async put(_t: string, item: any) {
            store.set(keyOf(item), { ...item });
            return {};
        },
        async update(_t: string, key: any, params: any) {
            const k = `${key.orgId}|${key.sk}`;
            const existing = store.get(k);
            // Conditional update (tryClaimForDial): evaluate `#status = :queued`.
            if (params.ConditionExpression) {
                const m = params.ConditionExpression.match(/#(\w+)\s*=\s*:(\w+)/);
                if (m) {
                    const attr = params.ExpressionAttributeNames[`#${m[1]}`];
                    const want = params.ExpressionAttributeValues[`:${m[2]}`];
                    if (!existing || existing[attr] !== want) throw new ConditionalCheckFailedException('condition failed');
                }
            }
            const item = existing ?? { orgId: key.orgId, sk: key.sk };
            const [setClause, removeClause] = params.UpdateExpression.split(/\bREMOVE\b/);
            for (const assign of setClause.replace(/^SET /, '').split(',')) {
                const [lhs, rhs] = assign.split('=').map((s: string) => s.trim());
                item[params.ExpressionAttributeNames[lhs]] = params.ExpressionAttributeValues[rhs];
            }
            for (const token of (removeClause ?? '').split(',').map((s: string) => s.trim()).filter(Boolean)) {
                delete item[params.ExpressionAttributeNames[token]];
            }
            store.set(k, item);
            return {};
        },
        async query(params: any) {
            if (params.IndexName === 'activeByNumber') {
                const shard = params.ExpressionAttributeValues[':shard'];
                let items = [...store.values()]
                    .filter((i) => i.activeNumberShard === shard)
                    .sort((a, b) => String(a.callId).localeCompare(String(b.callId)));
                if (params.ScanIndexForward === false) items.reverse();
                if (params.Limit) items = items.slice(0, params.Limit);
                return { Items: items };
            }
            const orgId = params.ExpressionAttributeValues[':orgId'];
            const prefix = params.ExpressionAttributeValues[':prefix'];
            let items = [...store.values()]
                .filter((i) => i.orgId === orgId)
                .filter((i) => (prefix ? String(i.sk).startsWith(prefix) : true))
                .sort((a, b) => String(a.sk).localeCompare(String(b.sk)));
            if (params.ScanIndexForward === false) items.reverse();
            if (params.Limit) items = items.slice(0, params.Limit);
            return { Items: items };
        },
        async delete(_t: string, key: any) {
            store.delete(`${key.orgId}|${key.sk}`);
            return {};
        },
    };
    return { ddb: ddb as unknown as IDdb, store };
}

const shard = (org: string, num: string) => `${org}#${num}`;

describe('CallRecordRepo — per-number serialization', () => {
    let repo: CallRecordRepo;

    beforeEach(() => { repo = new CallRecordRepo(makeStubDdb().ddb); });

    async function queue(callId: string, numberId: string, status = 'QUEUED') {
        await repo.put('org1', 'lead-' + callId, callId, {
            phoneNumber: '+61400000000', status: status as any,
            outboundNumberId: numberId, activeNumberShard: shard('org1', numberId),
        });
    }

    it('headQueuedByNumber returns the oldest QUEUED call on that number', async () => {
        await queue('01A', 'num1');
        await queue('01B', 'num1');
        await queue('01C', 'num2');
        const head = await repo.headQueuedByNumber('org1', 'num1');
        expect(head?.callId).toBe('01A'); // ULID asc = oldest first
    });

    it('hasActiveDialingByNumber is true only when a call is DIALING/IN_PROGRESS', async () => {
        await queue('01A', 'num1', 'QUEUED');
        expect(await repo.hasActiveDialingByNumber('org1', 'num1')).toBe(false);
        await queue('01B', 'num1', 'DIALING');
        expect(await repo.hasActiveDialingByNumber('org1', 'num1')).toBe(true);
    });

    it('clearing activeNumberShard drops the call out of the activeByNumber index', async () => {
        await queue('01A', 'num1');
        await repo.update('org1', 'lead-01A', '01A', { status: 'COMPLETED', activeNumberShard: null });
        expect(await repo.headQueuedByNumber('org1', 'num1')).toBeNull();
        expect(await repo.hasActiveDialingByNumber('org1', 'num1')).toBe(false);
    });

    it('tryClaimForDial claims a QUEUED call once and loses the race the second time', async () => {
        await queue('01A', 'num1');
        expect(await repo.tryClaimForDial('org1', 'lead-01A', '01A')).toBe(true);
        const row = await repo.get('org1', 'lead-01A', '01A');
        expect(row?.status).toBe('DIALING');
        // Second claim fails — status is no longer QUEUED (mutual exclusion latch).
        expect(await repo.tryClaimForDial('org1', 'lead-01A', '01A')).toBe(false);
    });
});

describe('CallRecordRepo — inbound-active markers', () => {
    let repo: CallRecordRepo;

    beforeEach(() => { repo = new CallRecordRepo(makeStubDdb().ddb); });

    it('put/get/clear an inbound-active marker scoped to the org', async () => {
        expect(await repo.getActiveInboundForOrg('org1')).toBeNull();
        await repo.putInboundActive('org1', 'inb1', { callerNumber: '+61411111111', agentId: 'agentA' });
        const live = await repo.getActiveInboundForOrg('org1');
        expect(live?.sk).toBe('INBOUND#ACTIVE#inb1');
        expect(live?.direction).toBe('inbound');
        // Another org is unaffected.
        expect(await repo.getActiveInboundForOrg('org2')).toBeNull();
        await repo.clearInboundActive('org1', 'inb1');
        expect(await repo.getActiveInboundForOrg('org1')).toBeNull();
    });

    it('markInboundCapturedLead attaches the captured lead to the live marker', async () => {
        await repo.putInboundActive('org1', 'inb1', { callerNumber: '+61411111111', agentId: 'agentA' });
        await repo.markInboundCapturedLead('org1', 'lead-99', 'pipe-1');
        const live = await repo.getActiveInboundForOrg('org1');
        expect(live?.capturedLeadId).toBe('lead-99');
        expect(live?.capturedPipelineId).toBe('pipe-1');
    });

    it('markInboundCapturedLead is a no-op when no inbound call is live', async () => {
        // Must not throw when the marker is gone (call ended / never marked).
        await expect(repo.markInboundCapturedLead('org1', 'lead-99')).resolves.toBeUndefined();
        expect(await repo.getActiveInboundForOrg('org1')).toBeNull();
    });
});
