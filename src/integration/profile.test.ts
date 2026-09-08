import { expect, it, vi, beforeEach, afterEach } from 'vitest';
import { BusinessProfileIntegrationRepo } from './profile';
import type { IDdb } from '../ddbPort';
it('isolates connection keys and does not consult the legacy credential row', async () => {
    const getItem = vi.fn().mockResolvedValue({});
    const repo = new BusinessProfileIntegrationRepo({ getItem } as unknown as IDdb, { orgId: 'org', businessProfileId: 'a' });
    expect(await repo.get('accounting')).toBeNull();
    expect(getItem).toHaveBeenCalledExactlyOnceWith(expect.anything(), { ownerId: 'org', provider: 'accounting:profile:a' });
});
it('rejects corrupt or foreign ownership before exposing credentials', async () => {
    const getItem = vi.fn().mockResolvedValue({ Item: { ownerId: 'org', config: { businessProfileId: 'b' }, credentials: 'secret' } });
    const repo = new BusinessProfileIntegrationRepo({ getItem } as unknown as IDdb, { orgId: 'org', businessProfileId: 'a' });
    await expect(repo.get('accounting')).rejects.toThrow('ownership mismatch');
});
function connectionStore() {
    let row: any = { ownerId: 'org', provider: 'accounting:profile:a', connectionVersion: 'v1', config: { businessProfileId: 'a', provider: 'xero' }, credentials: { accessToken: 'old' } };
    let afterRead: (() => void) | undefined;
    const ddb = {
        getItem: vi.fn(async () => {
            const snapshot = structuredClone(row);
            afterRead?.(); afterRead = undefined;
            return { Item: snapshot };
        }),
        put: vi.fn(async (_table: string, item: any) => { row = structuredClone(item); }),
        delete: vi.fn(async () => { row = undefined; }),
        transactWrite: vi.fn(async (items: any[]) => {
            const put = items[0].Put;
            expect(put.ConditionExpression).toBe('#version = :expected');
            expect(put.ExpressionAttributeNames['#version']).toBe('connectionVersion');
            if (!row || row.connectionVersion !== put.ExpressionAttributeValues[':expected']) throw new Error('ConditionalCheckFailed');
            row = structuredClone(put.Item);
        }),
    };
    return { ddb, repo: new BusinessProfileIntegrationRepo(ddb as unknown as IDdb, { orgId: 'org', businessProfileId: 'a' }),
        row: () => row, afterRead: (fn: () => void) => { afterRead = fn; }, replace: (next: any) => { row = next; } };
}
it('preserves credentials during chart updates and cannot override ownership keys', async () => {
    const store = connectionStore();
    await store.repo.put('accounting', { syncSettings: { chartCache: [] }, provider: 'accounting' }, 'v1');
    expect(store.row()).toMatchObject({ provider: 'accounting:profile:a', credentials: { accessToken: 'old' }, syncSettings: { chartCache: [] } });
    expect(store.row().connectionVersion).not.toBe('v1');
    await expect(store.repo.put('accounting', { ownerId: 'foreign' }, 'v1')).rejects.toThrow('ownership mismatch');
});
it('does not recreate a connection deleted after the update read', async () => {
    const store = connectionStore();
    store.afterRead(() => store.replace(undefined));
    await expect(store.repo.put('accounting', { syncSettings: { chartCache: [] } }, 'v1')).rejects.toThrow('ConditionalCheckFailed');
    expect(store.row()).toBeUndefined();
});
it('does not overwrite credentials rotated after the update read', async () => {
    const store = connectionStore();
    store.afterRead(() => store.replace({ ...store.row(), connectionVersion: 'v2', credentials: { accessToken: 'new' } }));
    await expect(store.repo.put('accounting', { syncSettings: {} }, 'v1')).rejects.toThrow('ConditionalCheckFailed');
    expect(store.row().credentials.accessToken).toBe('new');
});
it('rejects a stale caller snapshot even when the repository reads the latest row', async () => {
    const store = connectionStore();
    await store.repo.put('accounting', { credentials: { accessToken: 'new' } }, 'v1');
    await expect(store.repo.put('accounting', { credentials: { accessToken: 'old' } }, 'v1')).rejects.toThrow('connection changed');
    expect(store.row().credentials.accessToken).toBe('new');
});
it('only explicit connect creates credentials and produces a fresh version', async () => {
    const store = connectionStore();
    await store.repo.delete('accounting');
    await expect(store.repo.put('accounting', {}, 'v1')).rejects.toThrow('connection changed');
    const connected = await store.repo.connect('accounting', { credentials: { accessToken: 'authorized' }, config: { provider: 'xero' } });
    expect(connected.connectionVersion).toEqual(expect.any(String));
    expect(store.row().config.businessProfileId).toBe('a');
});

beforeEach(() => { vi.stubEnv('INTEGRATIONS_TABLE', 'integrations'); vi.stubEnv('ACCOUNTING_SYNC_TABLE', 'accounting-sync'); });
afterEach(() => vi.unstubAllEnvs());
