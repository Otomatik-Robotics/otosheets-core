import { expect, it, vi } from 'vitest';
import type { IDdb } from '../ddbPort';
import { ClientDynamoRepo } from './repo';
it('searches past filtered Dynamo pages for the email', async () => {
    const next = { orgId: 'org', clientId: 'page-1' };
    const client = { clientId: 'match' };
    const query = vi.fn().mockResolvedValueOnce({ Items: [], LastEvaluatedKey: next }).mockResolvedValueOnce({ Items: [client] });
    const repo = new ClientDynamoRepo({ query } as unknown as IDdb);
    expect(await repo.findClientByEmail('org', 'SAME@example.test')).toEqual(client);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toMatchObject({ FilterExpression: '#email = :email', ExpressionAttributeValues: { ':email': 'same@example.test' } });
    expect(query.mock.calls[1][0]).toMatchObject({ ExclusiveStartKey: next });
});
it('returns no match only after exhausting all filtered pages', async () => {
    const query = vi.fn().mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { clientId: 'next' } }).mockResolvedValueOnce({ Items: [] });
    expect(await new ClientDynamoRepo({ query } as unknown as IDdb).findClientByEmail('org', 'missing@example.test')).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
});
