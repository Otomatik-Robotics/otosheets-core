import { expect, it, vi, beforeEach, afterEach } from 'vitest';
import { OAuthStateRepo } from './oauthState';
import type { IDdb } from '../ddbPort';
it('claims a state once and returns false on conditional replay rejection', async () => {
    const update = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' });
    const repo = new OAuthStateRepo({ update } as unknown as IDdb);
    expect(await repo.consume('org', 'nonce', 'signed-state-hash', 100)).toBe(true);
    expect(await repo.consume('org', 'nonce', 'signed-state-hash', 100)).toBe(false);
    expect(update).toHaveBeenCalledWith(expect.anything(), { ownerId: 'OAUTHSTATE#org', provider: 'oauth-state:nonce' }, expect.objectContaining({
        ConditionExpression: 'attribute_exists(ownerId) AND stateHash = :hash AND expiresAt >= :now AND attribute_not_exists(consumedAt)',
        ExpressionAttributeValues: { ':hash': 'signed-state-hash', ':now': 100 },
    }));
});
it('does not treat database failure as successful consumption', async () => {
    const repo = new OAuthStateRepo({ update: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as IDdb);
    await expect(repo.consume('org', 'nonce', 'hash', 100)).rejects.toThrow('offline');
});

beforeEach(() => { vi.stubEnv('INTEGRATIONS_TABLE', 'integrations'); vi.stubEnv('ACCOUNTING_SYNC_TABLE', 'accounting-sync'); });
afterEach(() => vi.unstubAllEnvs());
