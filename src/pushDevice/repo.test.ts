import { describe, expect, it } from 'vitest';
import type { IDdb } from '../ddbPort';
import { PushDeviceRepo } from './repo';

function fixture() {
    const rows = new Map<string, any>();
    const key = (row: any) => `${row.userId}|${row.token}`;
    const ddb = {
        async getItem(_table: string, value: any) { return { Item: rows.get(key(value)) }; },
        async query(input: any) { return { Items: [...rows.values()].filter(row => row.userId === input.ExpressionAttributeValues[':user']) }; },
        async transactWrite(items: any[]) {
            for (const { Put, Delete } of items) {
                const old = rows.get(key(Put?.Item ?? Delete?.Key));
                if (Put?.ConditionExpression && (Put.ExpressionAttributeValues ? old?.bindingVersion !== Put.ExpressionAttributeValues[':previous'] : !!old)) throw new Error('Concurrent binding');
                if (Delete?.ConditionExpression) {
                    const values = Delete.ExpressionAttributeValues;
                    if (!old || old.bindingVersion !== values[':version'] || old.principalId !== values[':user'] || old.organizationId !== values[':org'] || old.businessProfileId !== values[':profile']) {
                        throw { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] };
                    }
                }
            }
            for (const { Put, Delete } of items) {
                if (Put) rows.set(key(Put.Item), structuredClone(Put.Item));
                if (Delete) rows.delete(key(Delete.Key));
            }
            return {};
        },
    } as unknown as IDdb;
    return { repo: new PushDeviceRepo(ddb, 'devices'), rows };
}
const a = { orgId: 'org', businessProfileId: 'a' };
const b = { orgId: 'org', businessProfileId: 'b' };

describe('push device binding', () => {
    it('only delivers for the current profile and does not store the raw provider token', async () => {
        const { repo, rows } = fixture();
        await repo.register('user', 'secret-token', 'ios', 'endpoint', a);
        expect((await repo.list('user', a))).toHaveLength(1);
        expect(await repo.list('user', b)).toEqual([]);
        expect(JSON.stringify([...rows])).not.toContain('secret-token');
        await repo.register('user', 'secret-token', 'ios', 'endpoint', b);
        expect(await repo.list('user', a)).toEqual([]);
        expect(await repo.list('user', b)).toHaveLength(1);
    });
    it('a new login owns the device and old user rows and stale cleanup cannot regain or remove it', async () => {
        const { repo } = fixture();
        await repo.register('old-user', 'token', 'ios', 'endpoint', a);
        const old = (await repo.list('old-user', a))[0];
        await repo.register('new-user', 'token', 'ios', 'endpoint', a);
        expect(await repo.list('old-user', a)).toEqual([]);
        await repo.removeIfCurrent(old);
        await repo.unregister('old-user', 'token', a);
        expect(await repo.list('new-user', a)).toHaveLength(1);
        await repo.unregister('new-user', 'token', a);
        expect(await repo.list('new-user', a)).toEqual([]);
    });
    it('ignores legacy rows and refuses an unregister from another selected profile', async () => {
        const { repo, rows } = fixture();
        rows.set('user|legacy', { userId: 'user', token: 'legacy', endpointArn: 'legacy', organizationId: 'org', businessProfileId: 'a' });
        expect(await repo.list('user', a)).toEqual([]);
        await repo.register('user', 'token', 'android', 'endpoint', a);
        await repo.unregister('user', 'token', b);
        expect(await repo.list('user', a)).toHaveLength(1);
    });
});
