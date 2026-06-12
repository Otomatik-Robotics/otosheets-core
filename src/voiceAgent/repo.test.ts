import { describe, it, expect, beforeEach } from 'vitest';
import { VoiceAgentRepo } from './repo';
import type { IDdb } from '../ddbPort';

// Minimal in-memory IDdb stub — implements only what VoiceAgentRepo uses.
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
                item[params.ExpressionAttributeNames[lhs]] = params.ExpressionAttributeValues[rhs];
            }
            store.set(`${key.orgId}|${key.sk}`, item);
            return {};
        },
        async query(params: any) {
            const orgId = params.ExpressionAttributeValues[':orgId'];
            const prefix = params.ExpressionAttributeValues[':prefix'];
            let items = [...store.values()]
                .filter((i) => i.orgId === orgId && String(i.sk).startsWith(prefix));
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

describe('VoiceAgentRepo', () => {
    let repo: VoiceAgentRepo;
    let store: Map<string, any>;

    beforeEach(() => {
        const stub = makeStubDdb();
        repo = new VoiceAgentRepo(stub.ddb);
        store = stub.store;
    });

    it('round-trips put → get under the AGENT# prefix', async () => {
        await repo.put('org1', 'a1', { name: 'Quoter', systemPrompt: 'You are…', tools: { offer_bookings: true } });
        const agent = await repo.get('org1', 'a1');
        expect(agent).toMatchObject({ orgId: 'org1', sk: 'AGENT#a1', agentId: 'a1', name: 'Quoter' });
        expect(agent?.createdAt).toBeTruthy();
    });

    it('list returns only agents, not call records sharing the table', async () => {
        await repo.put('org1', 'a1', { name: 'A', systemPrompt: 'p' });
        store.set('org1|CALL#lead1#c1', { orgId: 'org1', sk: 'CALL#lead1#c1', status: 'QUEUED' });
        const agents = await repo.list('org1');
        expect(agents).toHaveLength(1);
        expect(agents[0].agentId).toBe('a1');
    });

    it('update sets only provided fields and never key fields', async () => {
        await repo.put('org1', 'a1', { name: 'A', systemPrompt: 'p', phoneNumber: '+61280000000' });
        await repo.update('org1', 'a1', { systemPrompt: 'p2', agentId: 'hax' } as any);
        const agent = await repo.get('org1', 'a1');
        expect(agent?.systemPrompt).toBe('p2');
        expect(agent?.phoneNumber).toBe('+61280000000');
        expect(agent?.agentId).toBe('a1');
    });

    it('delete removes the agent', async () => {
        await repo.put('org1', 'a1', { name: 'A', systemPrompt: 'p' });
        await repo.delete('org1', 'a1');
        expect(await repo.get('org1', 'a1')).toBeNull();
    });
});
