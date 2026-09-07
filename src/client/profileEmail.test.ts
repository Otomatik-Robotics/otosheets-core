import { expect, it, vi } from 'vitest';
import type { IDdb } from '../ddbPort';
import { ClientDynamoRepo } from './repo';
it('searches past filtered Dynamo pages using the requested profile', async () => {
    const next = { orgId: 'org', clientId: 'page-1' };
    const client = { clientId: 'match', businessProfileId: 'profile-a' };
    const query = vi.fn().mockResolvedValueOnce({ Items: [], LastEvaluatedKey: next }).mockResolvedValueOnce({ Items: [client] });
    const repo = new ClientDynamoRepo({ query } as unknown as IDdb);
    expect(await repo.findClientByEmail('org', 'SAME@example.test', 'profile-a')).toEqual(client);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toMatchObject({ FilterExpression: '#email = :email AND #profile = :profile', ExpressionAttributeValues: { ':email': 'same@example.test', ':profile': 'profile-a' } });
    expect(query.mock.calls[1][0]).toMatchObject({ ExclusiveStartKey: next });
});
it('returns no match only after exhausting all filtered pages', async () => {
    const query = vi.fn().mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { clientId: 'next' } }).mockResolvedValueOnce({ Items: [] });
    expect(await new ClientDynamoRepo({ query } as unknown as IDdb).findClientByEmail('org', 'missing@example.test', 'profile-a')).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
});
