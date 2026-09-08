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
it('preserves credentials during chart updates and cannot override ownership keys', async () => {
    const existing = { ownerId: 'org', provider: 'accounting:profile:a', config: { businessProfileId: 'a', provider: 'xero' }, credentials: { accessToken: 'secret' } };
    const ddb = { getItem: vi.fn().mockResolvedValue({ Item: existing }), put: vi.fn() };
    const repo = new BusinessProfileIntegrationRepo(ddb as unknown as IDdb, { orgId: 'org', businessProfileId: 'a' });
    await repo.put('accounting', { syncSettings: { chartCache: [] }, provider: 'accounting' });
    expect(ddb.put).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ...existing, syncSettings: { chartCache: [] } }));
    await expect(repo.put('accounting', { ownerId: 'foreign' })).rejects.toThrow('ownership mismatch');
});

beforeEach(() => { vi.stubEnv('INTEGRATIONS_TABLE', 'integrations'); vi.stubEnv('ACCOUNTING_SYNC_TABLE', 'accounting-sync'); });
afterEach(() => vi.unstubAllEnvs());
