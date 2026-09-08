import { expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { IDdb } from '../ddbPort';
import { AccountingSyncRepo } from './repo';
it('profile scope covers record keys and list/count queries', async () => {
    const ddb = { getItem: vi.fn().mockResolvedValue({}), put: vi.fn(), query: vi.fn().mockResolvedValue({ Items: [], Count: 0 }) };
    const repo = new AccountingSyncRepo(ddb as unknown as IDdb).withScope('org', 'a');
    await repo.get('org', 'expense', 'receipt');
    expect(ddb.getItem).toHaveBeenCalledWith(expect.anything(), { orgId: 'org', sk: 'PROFILE#a#expense#receipt' });
    await repo.put('org', 'expense', 'receipt', { orgId: 'foreign', sk: 'foreign', entityId: 'foreign' } as any);
    expect(ddb.put).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orgId: 'org', sk: 'PROFILE#a#expense#receipt', entityId: 'receipt', businessProfileId: 'a' }));
    await repo.listByOrg({ orgId: 'org' });
    await repo.countByStatus('org', 'FAILED');
    for (const [query] of ddb.query.mock.calls) expect(query).toMatchObject({ KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :profile)', ExpressionAttributeValues: expect.objectContaining({ ':profile': 'PROFILE#a#' }) });
    await expect(repo.get('foreign', 'expense', 'receipt')).rejects.toThrow('organisation mismatch');
});

beforeEach(() => { vi.stubEnv('INTEGRATIONS_TABLE', 'integrations'); vi.stubEnv('ACCOUNTING_SYNC_TABLE', 'accounting-sync'); });
afterEach(() => vi.unstubAllEnvs());
