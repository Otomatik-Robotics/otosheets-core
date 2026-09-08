import { describe, expect, it } from 'vitest';
import type { IDdb } from '../ddbPort';
import { PushDeviceRepo } from './repo';
function fixture() {
    const rows = new Map<string, any>();
    const key = (row: any) => `${row.userId}|${row.token}`;
    let now = 100;
    const ddb = {
        async getItem(_table: string, value: any) { return { Item: rows.get(key(value)) }; },
        async query(input: any) { return { Items: [...rows.values()].filter(row => row.userId === input.ExpressionAttributeValues[':user']) }; },
        async transactWrite(items: any[]) {
            for (const { Put } of items) {
                if (!Put?.ConditionExpression) continue;
                const old = rows.get(key(Put.Item)), values = Put.ExpressionAttributeValues;
                const condition = Put.ConditionExpression;
                let allowed: boolean;
                if (condition.startsWith('attribute_not_exists(highWater)')) {
                    allowed = old?.highWater === undefined || old.highWater < values[':generation'];
                } else if (condition === 'attribute_not_exists(token)') {
                    allowed = !old;
                } else if (values[':previous'] !== undefined) {
                    allowed = old?.bindingVersion === values[':version'] && old.highWater === values[':previous'];
                } else {
                    allowed = old?.bindingVersion === values[':version'] && old.highWater === values[':generation']
                        && old.generation === values[':generation'] && old.expiresAt > values[':now'];
                }
                if (!allowed) throw { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] };
            }
            for (const { Put } of items) if (Put) rows.set(key(Put.Item), structuredClone(Put.Item));
            return {};
        },
    } as unknown as IDdb;
    return { repo: new PushDeviceRepo(ddb, 'devices', () => now), rows, ddb, advance: (seconds: number) => { now += seconds; } };
}
const a = { orgId: 'org', businessProfileId: 'a' }, b = { orgId: 'org', businessProfileId: 'b' };
describe('push device binding generation', () => {
    it('only delivers the current profile and hashes the raw token at rest', async () => {
        const { repo, rows } = fixture();
        await repo.register('user', 'secret-token', 'ios', 'endpoint', a, 1);
        expect(await repo.list('user', a)).toHaveLength(1); expect(await repo.list('user', b)).toEqual([]);
        expect(JSON.stringify([...rows])).not.toContain('secret-token');
        await repo.register('user', 'secret-token', 'ios', 'endpoint', b, 2);
        expect(await repo.list('user', a)).toEqual([]); expect(await repo.list('user', b)).toHaveLength(1);
    });
    it('rejects old-runtime A even when its first server operation occurs after new-runtime B', async () => {
        const { repo } = fixture();
        await repo.register('new-user', 'token', 'ios', 'endpoint', b, 2);
        await expect(repo.beginRegistration('old-user', 'token', a, 1)).rejects.toMatchObject({ name: 'TransactionCanceledException' });
        expect(await repo.list('new-user', b)).toHaveLength(1);
    });
    it('rejects a paused provider completion after a newer profile reservation', async () => {
        const { repo } = fixture();
        const old = await repo.beginRegistration('user', 'token', a, 1);
        await repo.register('user', 'token', 'ios', 'endpoint', b, 2);
        await expect(repo.completeRegistration(old, 'ios', 'old-endpoint')).rejects.toMatchObject({ name: 'TransactionCanceledException' });
        expect(await repo.list('user', a)).toEqual([]); expect(await repo.list('user', b)).toHaveLength(1);
    });
    it('retains logout tombstones before any registration arrives and rejects resurrection', async () => {
        const { repo } = fixture();
        await repo.unregister('user', 'token', a, 2);
        await expect(repo.register('user', 'token', 'ios', 'endpoint', a, 1)).rejects.toMatchObject({ name: 'TransactionCanceledException' });
        await repo.register('user', 'token', 'ios', 'endpoint', a, 3);
        const old = (await repo.list('user', a))[0];
        await repo.unregister('user', 'token', a, 4);
        await expect(repo.completeRegistration({ ...old, expiresAt: 160 }, 'ios', 'endpoint')).rejects.toMatchObject({ name: 'TransactionCanceledException' });
        expect(await repo.list('user', a)).toEqual([]);
    });
    it('preserves a newer user/profile against stale unregister and cleanup', async () => {
        const { repo } = fixture();
        await repo.register('old', 'token', 'ios', 'endpoint', a, 1);
        const old = (await repo.list('old', a))[0];
        await repo.register('new', 'token', 'ios', 'endpoint', b, 2);
        await repo.removeIfCurrent(old); await repo.unregister('old', 'token', a, 3);
        expect(await repo.list('new', b)).toHaveLength(1); expect(await repo.list('old', a)).toEqual([]);
    });
    it('allows only one competing reservation for an identical generation', async () => {
        const { repo } = fixture();
        const results = await Promise.allSettled([repo.beginRegistration('one', 'token', a, 1), repo.beginRegistration('two', 'token', b, 1)]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    });
    it('rejects expired provider completion and excludes legacy rows', async () => {
        const { repo, rows, advance } = fixture();
        rows.set('user|legacy', { userId: 'user', token: 'legacy', organizationId: 'org', businessProfileId: 'a', endpointArn: 'legacy' });
        const lease = await repo.beginRegistration('user', 'token', a, 1); advance(61);
        await expect(repo.completeRegistration(lease, 'ios', 'endpoint')).rejects.toMatchObject({ name: 'TransactionCanceledException' });
        expect(await repo.list('user', a)).toEqual([]);
    });
    it('cleanup paused before commit cannot erase a newer binding or its generation', async () => {
        const { repo, ddb } = fixture();
        await repo.register('user', 'token', 'ios', 'endpoint', a, 1);
        const old = (await repo.list('user', a))[0], transact = ddb.transactWrite.bind(ddb);
        let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
        ddb.transactWrite = async items => { if (items[0].Put?.Item.state === 'revoked') await wait; return transact(items); };
        const cleanup = repo.removeIfCurrent(old);
        await repo.register('user', 'token', 'ios', 'endpoint', b, 2); release(); await cleanup;
        expect(await repo.list('user', b)).toHaveLength(1);
    });
    it('records logout A3 over an older B1 binding without erasing B, then rejects delayed A2', async () => {
        const { repo } = fixture();
        await repo.register('user', 'token', 'ios', 'endpoint', b, 1);
        await repo.unregister('user', 'token', a, 3);
        expect(await repo.list('user', b)).toHaveLength(1);
        await expect(repo.register('user', 'token', 'ios', 'endpoint', a, 2)).rejects.toMatchObject({ name: 'TransactionCanceledException' });
        expect(await repo.list('user', a)).toEqual([]);
    });
    it('retains a foreign-user barrier through disabled-device cleanup', async () => {
        const { repo } = fixture();
        await repo.register('old', 'token', 'ios', 'endpoint', b, 1);
        const device = (await repo.list('old', b))[0];
        await repo.unregister('new', 'token', a, 3);
        await repo.removeIfCurrent(device);
        await expect(repo.beginRegistration('new', 'token', a, 2)).rejects.toMatchObject({ name: 'TransactionCanceledException' });
    });
    it('does not change a newer B4 binding when delayed logout A3 arrives', async () => {
        const { repo } = fixture();
        await repo.register('new', 'token', 'ios', 'endpoint', b, 4);
        await repo.unregister('old', 'token', a, 3);
        expect(await repo.list('new', b)).toHaveLength(1);
    });

});
