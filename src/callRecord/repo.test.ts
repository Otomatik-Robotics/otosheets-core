import { describe, it, expect, beforeEach } from 'vitest';
import { CallRecordRepo } from './repo';
import type { IDdb } from '../ddbPort';

// Minimal in-memory IDdb stub — implements only what CallRecordRepo uses.
function makeStubDdb() {
    const store = new Map<string, any>();
    const keyOf = (item: any) => `${item.orgId}|${item.sk}`;
    const ddb = {
        async getItem(_t: string, key: any) {
            return { Item: store.get(`${key.orgId}|${key.sk}`) };
        },
        async put(_t: string, item: any) {
            store.set(keyOf(item), { ...item });
            return {};
        },
        async update(_t: string, key: any, params: any) {
            const item = store.get(`${key.orgId}|${key.sk}`) ?? { orgId: key.orgId, sk: key.sk };
            const sets = params.UpdateExpression.replace(/^SET /, '').split(',');
            for (const assign of sets) {
                const [lhs, rhs] = assign.split('=').map((s: string) => s.trim());
                const attr = params.ExpressionAttributeNames[lhs];
                item[attr] = params.ExpressionAttributeValues[rhs];
            }
            store.set(`${key.orgId}|${key.sk}`, item);
            return {};
        },
        async query(params: any) {
            const orgId = params.ExpressionAttributeValues[':orgId'];
            const prefix = params.ExpressionAttributeValues[':prefix'];
            let items = [...store.values()]
                .filter((i) => i.orgId === orgId)
                .filter((i) => (prefix ? String(i.sk).startsWith(prefix) : true))
                .sort((a, b) => String(a.sk).localeCompare(String(b.sk)));
            if (params.ScanIndexForward === false) items.reverse();
            if (params.FilterExpression && params.ExpressionAttributeValues[':status'] != null) {
                items = items.filter((i) => i.status === params.ExpressionAttributeValues[':status']);
            }
            if (params.Select === 'COUNT') return { Count: items.length };
            if (params.Limit) items = items.slice(0, params.Limit);
            return { Items: items };
        },
    };
    return { ddb: ddb as unknown as IDdb, store };
}

describe('CallRecordRepo', () => {
    let repo: CallRecordRepo;

    beforeEach(() => {
        repo = new CallRecordRepo(makeStubDdb().ddb);
    });

    it('round-trips put → get with the composite sort key', async () => {
        await repo.put('org1', 'lead1', 'c1', { phoneNumber: '+61400000000', status: 'QUEUED', provider: 'vapi' });
        const row = await repo.get('org1', 'lead1', 'c1');
        expect(row).toMatchObject({ orgId: 'org1', sk: 'CALL#lead1#c1', leadId: 'lead1', callId: 'c1', status: 'QUEUED' });
        expect(row?.createdAt).toBeTruthy();
        expect(row?.updatedAt).toBeTruthy();
    });

    it('returns null for a missing row', async () => {
        expect(await repo.get('org1', 'lead1', 'nope')).toBeNull();
    });

    it('update sets only the provided fields and preserves the rest', async () => {
        await repo.put('org1', 'lead1', 'c1', { phoneNumber: '+61400000000', status: 'QUEUED' });
        await repo.update('org1', 'lead1', 'c1', { status: 'COMPLETED', outcome: 'Booked a quote visit', durationSeconds: 95 });
        const row = await repo.get('org1', 'lead1', 'c1');
        expect(row?.status).toBe('COMPLETED');
        expect(row?.outcome).toBe('Booked a quote visit');
        expect(row?.durationSeconds).toBe(95);
        expect(row?.phoneNumber).toBe('+61400000000'); // preserved
    });

    it('update never overwrites key fields', async () => {
        await repo.put('org1', 'lead1', 'c1', { phoneNumber: '+61400000000', status: 'QUEUED' });
        await repo.update('org1', 'lead1', 'c1', { leadId: 'other', callId: 'other', status: 'FAILED' } as any);
        const row = await repo.get('org1', 'lead1', 'c1');
        expect(row?.leadId).toBe('lead1');
        expect(row?.callId).toBe('c1');
        expect(row?.status).toBe('FAILED');
    });

    it('listByLead returns only that lead, newest first', async () => {
        await repo.put('org1', 'lead1', '01A', { phoneNumber: '+61400000001', status: 'COMPLETED' });
        await repo.put('org1', 'lead1', '01B', { phoneNumber: '+61400000001', status: 'QUEUED' });
        await repo.put('org1', 'lead2', '01C', { phoneNumber: '+61400000002', status: 'QUEUED' });
        const calls = await repo.listByLead('org1', 'lead1');
        expect(calls).toHaveLength(2);
        expect(calls[0].callId).toBe('01B'); // newest first
        expect(calls[1].callId).toBe('01A');
    });

    it('latestForLead returns the most recent call or null', async () => {
        expect(await repo.latestForLead('org1', 'lead1')).toBeNull();
        await repo.put('org1', 'lead1', '01A', { phoneNumber: '+61400000001', status: 'COMPLETED' });
        await repo.put('org1', 'lead1', '01B', { phoneNumber: '+61400000001', status: 'QUEUED' });
        expect((await repo.latestForLead('org1', 'lead1'))?.callId).toBe('01B');
    });

    it('listByOrg filters by status and scopes to the org', async () => {
        await repo.put('org1', 'lead1', 'c1', { phoneNumber: '+61400000001', status: 'QUEUED' });
        await repo.put('org1', 'lead2', 'c2', { phoneNumber: '+61400000002', status: 'BLOCKED', blockReason: 'DNCR' });
        await repo.put('org2', 'lead3', 'c3', { phoneNumber: '+61400000003', status: 'BLOCKED' });
        const blocked = await repo.listByOrg({ orgId: 'org1', status: 'BLOCKED' });
        expect(blocked.items).toHaveLength(1);
        expect(blocked.items[0].callId).toBe('c2');
    });

    it('countByStatus counts only the org + status', async () => {
        await repo.put('org1', 'lead1', 'c1', { phoneNumber: '+61400000001', status: 'QUEUED' });
        await repo.put('org1', 'lead2', 'c2', { phoneNumber: '+61400000002', status: 'QUEUED' });
        await repo.put('org1', 'lead3', 'c3', { phoneNumber: '+61400000003', status: 'COMPLETED' });
        expect(await repo.countByStatus('org1', 'QUEUED')).toBe(2);
        expect(await repo.countByStatus('org1', 'COMPLETED')).toBe(1);
    });
});
