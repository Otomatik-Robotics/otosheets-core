import { describe, expect, it } from 'vitest';
import type { IDdb } from '../ddbPort';
import { WebsocketAdmissionRepo, type WebsocketIdentity } from './repo';

function fixture() {
    const rows = new Map<string, any>();
    const writes: any[] = [];
    let now = 1000;
    const key = (item: any) => `${item.userId}|${item.connectionId}`;
    const ddb = {
        async getItem(_table: string, item: any) { return { Item: rows.get(key(item)) }; },
        async query(input: any) {
            return { Items: [...rows.values()].filter(row => input.IndexName
                ? row.connectionId === input.ExpressionAttributeValues[':id']
                : row.userId === input.ExpressionAttributeValues[':userId']) };
        },
        async transactWrite(items: any[]) {
            writes.push(items);
            // Dynamo validates every condition before applying any member of a transaction.
            for (const item of items) {
                if (item.Put && rows.has(key(item.Put.Item))) throw new Error('ConditionalCheckFailed');
                if (item.Delete) {
                    const old = rows.get(key(item.Delete.Key));
                    const values = item.Delete.ExpressionAttributeValues;
                    if (!old || old.audience !== values[':audience'] || old.expiresAt <= values[':now']) throw new Error('ConditionalCheckFailed');
                }
            }
            for (const item of items) {
                if (item.Put) rows.set(key(item.Put.Item), structuredClone(item.Put.Item));
                if (item.Delete) rows.delete(key(item.Delete.Key));
            }
            return {};
        },
    } as unknown as IDdb;
    return { repo: new WebsocketAdmissionRepo(ddb, 'connections', 'env:api', () => now), ddb, rows, writes, advance: (seconds: number) => { now += seconds; } };
}
const business: WebsocketIdentity = { userId: 'user', kind: 'business', orgId: 'org' };

describe('WebSocket admission', () => {
    it('stores only a hashed ticket and admits one concurrent consumer with canonical identity', async () => {
        const { repo, rows, writes } = fixture();
        const { ticket } = await repo.issue(business);
        expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(JSON.stringify([...rows])).not.toContain(ticket);
        const results = await Promise.allSettled(['one', 'two'].map(id => repo.connect(ticket, id, async () => true)));
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const admitted = [...rows.values()].find(row => row.admissionVersion === 1);
        expect(admitted).toMatchObject({ ...business, audience: 'env:api', expiresAt: 1300 });
        expect(await repo.getConnection(admitted.connectionId)).toMatchObject(business);
        expect(writes[1][0].Delete.ConditionExpression).toContain('expiresAt > :now');
        expect(writes[1][1].Put.ConditionExpression).toBe('attribute_not_exists(connectionId)');
        await expect(repo.connect(ticket, 'replay', async () => true)).rejects.toThrow();
    });

    it('rejects wrong audience, expired tickets and revoked scope before connection writes', async () => {
        const { repo, ddb, rows, advance } = fixture();
        const { ticket } = await repo.issue(business);
        await expect(new WebsocketAdmissionRepo(ddb, 'connections', 'other-api', () => 1000).connect(ticket, 'wrong', async () => true)).rejects.toThrow('denied');
        await expect(repo.connect(ticket, 'revoked', async () => false)).rejects.toThrow('denied');
        advance(60);
        await expect(repo.connect(ticket, 'expired', async () => true)).rejects.toThrow('denied');
        expect([...rows.values()].some(row => row.admissionVersion === 1)).toBe(false);
    });

    it('checks expiry again atomically after authorization and retains ticket if the connection write fails', async () => {
        const { repo, rows, advance } = fixture();
        const first = await repo.issue(business);
        await expect(repo.connect(first.ticket, 'late', async () => { advance(60); return true; })).rejects.toThrow();
        const second = await repo.issue(business);
        rows.set('user|occupied', { userId: 'user', connectionId: 'occupied' });
        await expect(repo.connect(second.ticket, 'occupied', async () => true)).rejects.toThrow();
        expect(await repo.connect(second.ticket, 'retry', async () => true)).toMatchObject(business);
    });

    it('never returns legacy, expired, account-only, foreign-org or foreign-audience connections for business fanout', async () => {
        const { repo, rows, advance } = fixture();
        const first = await repo.issue(business);
        await repo.connect(first.ticket, 'own', async () => true);
        const other = await repo.issue({ ...business, orgId: 'org-b' });
        await repo.connect(other.ticket, 'other', async () => true);
        const account = await repo.issue({ userId: 'user', kind: 'account' });
        await repo.connect(account.ticket, 'account', async () => true);
        rows.set('user|legacy', { userId: 'user', connectionId: 'legacy', ...business });
        rows.set('user|audience', { ...rows.get('user|own'), connectionId: 'audience', audience: 'other' });
        expect((await repo.listBusinessConnections('user', 'org')).map(row => row.connectionId)).toEqual(['own']);
        expect(await repo.getConnection('legacy')).toBeNull();
        advance(300);
        expect(await repo.listBusinessConnections('user', 'org')).toEqual([]);
        expect(await repo.getConnection('own')).toBeNull();
    });
});
