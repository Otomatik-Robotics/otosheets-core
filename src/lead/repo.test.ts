import { describe, it, expect, beforeEach } from 'vitest';
import { LeadRepo } from './repo';
import { sk } from '../keys';
import type { IDdb } from '../ddbPort';

// Minimal in-memory IDdb stub — implements only what LeadRepo.deleteLead uses.
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
        async delete(_t: string, key: any) {
            store.delete(`${key.orgId}|${key.sk}`);
            return {};
        },
    };
    return { ddb: ddb as unknown as IDdb, store };
}

describe('LeadRepo.deleteLead', () => {
    let repo: LeadRepo;
    let store: Map<string, any>;

    beforeEach(() => {
        const stub = makeStubDdb();
        repo = new LeadRepo(stub.ddb);
        store = stub.store;
    });

    it('removes the lead item at the owner-scoped key', async () => {
        const key = `org1|${sk('user1', 'lead1')}`;
        store.set(key, { orgId: 'org1', sk: sk('user1', 'lead1'), leadId: 'lead1' });

        await repo.deleteLead('org1', 'user1', 'lead1');

        expect(store.has(key)).toBe(false);
    });

    it('does not throw when the lead is already gone', async () => {
        await expect(repo.deleteLead('org1', 'user1', 'missing')).resolves.toBeUndefined();
    });
});
