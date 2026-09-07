import { expect, test, vi } from 'vitest';
import { DocumentRepo } from './repo';
import type { IDdb } from '../ddbPort';

test('document pagination filters in Dynamo and binds tokens to the profile', async () => {
 const query = vi.fn().mockResolvedValue({ Items: [], LastEvaluatedKey: { orgId: 'org-1', sk: 'DOC#last' } });
 const repo = new DocumentRepo({ query } as unknown as IDdb);
 const first = await repo.listPage('org-1', { businessProfileId: 'profile-a', limit: 2 });
 expect(query).toHaveBeenCalledWith(expect.objectContaining({ FilterExpression: 'businessProfileId = :profile', Limit: 2, ExpressionAttributeValues: { ':orgId': 'org-1', ':prefix': 'DOC#', ':profile': 'profile-a' } }));
 await expect(repo.listPage('org-1', { businessProfileId: 'profile-b', nextToken: first.nextToken })).rejects.toThrow('Invalid document nextToken');
 expect(query).toHaveBeenCalledTimes(1);
 await repo.listPage('org-1', { businessProfileId: 'profile-a', nextToken: first.nextToken });
 expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ ExclusiveStartKey: { orgId: 'org-1', sk: 'DOC#last' } }));
});
test('new document creation is conditional and retains profile ownership', async () => {
 const transactWrite = vi.fn().mockResolvedValue({});
 const repo = new DocumentRepo({ transactWrite } as unknown as IDdb);
 const doc = { documentId: 'doc-1', businessProfileId: 'profile-a', s3Key: 'profile-a/file.pdf', name: 'File', description: '', category: 'general', createdBy: 'user-1' };
 await repo.create('org-1', doc);
 expect(transactWrite).toHaveBeenCalledWith([{ Put: expect.objectContaining({ ConditionExpression: 'attribute_not_exists(sk)', Item: expect.objectContaining({ orgId: 'org-1', businessProfileId: 'profile-a' }) }) }]);
});
test('replay cannot replace a foreign profile document or repoint an owned object', async () => {
 const transactWrite = vi.fn().mockRejectedValue(Object.assign(new Error(), { name: 'TransactionCanceledException' }));
 const existing = { documentId: 'doc-1', businessProfileId: 'profile-a', s3Key: 'profile-a/file.pdf', name: 'File', description: '', category: 'general', createdBy: 'user-1', createdAt: 'original' };
 const repo = new DocumentRepo({ transactWrite, getItem: vi.fn().mockResolvedValue({ Item: existing }) } as unknown as IDdb);
 expect(await repo.create('org-1', existing)).toEqual(existing);
 await expect(repo.create('org-1', { ...existing, businessProfileId: 'profile-b' })).rejects.toThrow('already exists');
 await expect(repo.create('org-1', { ...existing, s3Key: 'different.pdf' })).rejects.toThrow('already exists');
});
