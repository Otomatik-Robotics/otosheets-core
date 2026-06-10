import { describe, it, expect, beforeEach } from 'vitest';
import { AccountingSyncRepo } from './repo';
import type { IDdb } from '../ddbPort';

// Minimal in-memory IDdb stub — implements only what AccountingSyncRepo uses.
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
            let items = [...store.values()].filter((i) => i.orgId === orgId);
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

describe('AccountingSyncRepo', () => {
    let repo: AccountingSyncRepo;

    beforeEach(() => {
        repo = new AccountingSyncRepo(makeStubDdb().ddb);
    });

    it('round-trips put → get with the composite sort key', async () => {
        await repo.put('org1', 'invoice', 'i1', { provider: 'xero', externalId: 'X1', status: 'SYNCED', contentHash: 'h1' });
        const row = await repo.get('org1', 'invoice', 'i1');
        expect(row).toMatchObject({ orgId: 'org1', sk: 'invoice#i1', entityType: 'invoice', entityId: 'i1', externalId: 'X1', status: 'SYNCED' });
        expect(row?.createdAt).toBeTruthy();
        expect(row?.updatedAt).toBeTruthy();
    });

    it('returns null for a missing row', async () => {
        expect(await repo.get('org1', 'contact', 'nope')).toBeNull();
    });

    it('listByOrg filters by status', async () => {
        await repo.put('org1', 'invoice', 'i1', { provider: 'xero', status: 'SYNCED' });
        await repo.put('org1', 'invoice', 'i2', { provider: 'xero', status: 'FAILED' });
        await repo.put('org2', 'invoice', 'i3', { provider: 'xero', status: 'FAILED' });
        const failed = await repo.listByOrg({ orgId: 'org1', status: 'FAILED' });
        expect(failed.items).toHaveLength(1);
        expect(failed.items[0].entityId).toBe('i2');
    });

    it('countByStatus counts only the org + status', async () => {
        await repo.put('org1', 'invoice', 'i1', { provider: 'xero', status: 'SYNCED' });
        await repo.put('org1', 'expense', 'e1', { provider: 'xero', status: 'SYNCED' });
        await repo.put('org1', 'invoice', 'i2', { provider: 'xero', status: 'FAILED' });
        expect(await repo.countByStatus('org1', 'SYNCED')).toBe(2);
        expect(await repo.countByStatus('org1', 'FAILED')).toBe(1);
    });

    it('markFailed sets status + error on an existing row', async () => {
        await repo.put('org1', 'invoice', 'i1', { provider: 'xero', externalId: 'X1', status: 'SYNCED' });
        await repo.markFailed('org1', 'invoice', 'i1', 'boom');
        const row = await repo.get('org1', 'invoice', 'i1');
        expect(row?.status).toBe('FAILED');
        expect(row?.lastError).toBe('boom');
        expect(row?.externalId).toBe('X1'); // preserved
    });
});
