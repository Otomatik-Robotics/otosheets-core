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

test('scoped document ports remain immutable across concurrent profiles and reject overrides before I/O', async () => {
 const getItem = vi.fn().mockResolvedValue({}); const query = vi.fn(); const update = vi.fn(); const transactWrite = vi.fn();
 const root = new DocumentRepo({ getItem, query, update, transactWrite } as unknown as IDdb);
 const a = root.withScope('org', 'a'); const b = root.withScope('org', 'b');
 await Promise.all([a.get('org', 'doc'), b.get('org', 'doc')]);
 expect(getItem).toHaveBeenCalledTimes(2); expect(getItem.mock.calls[0][2]).toEqual({ ConsistentRead: true });
 expect(() => a.withScope('org', 'b')).toThrow('mismatch'); expect(() => root.withScope('org', '')).toThrow('required');
 await expect(a.get('other', 'doc')).rejects.toThrow('mismatch');
 await expect(a.update('other', 'doc', { name: 'x' })).rejects.toThrow('mismatch');
 await expect(a.delete('other', 'doc')).rejects.toThrow('mismatch');
 await expect(a.listPage('org', { businessProfileId: 'b' })).rejects.toThrow('mismatch');
 await expect(a.list('org')).rejects.toThrow('listPage');
 expect(getItem).toHaveBeenCalledTimes(2); expect(query).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled(); expect(transactWrite).not.toHaveBeenCalled();
});

test.each([undefined, null, 'b'])('scoped strong reads quarantine missing/foreign profile %s', async businessProfileId => {
 const getItem = vi.fn().mockResolvedValue({ Item: { orgId: 'org', sk: 'DOC#doc', documentId: 'doc', businessProfileId } });
 expect(await new DocumentRepo({ getItem } as unknown as IDdb).withScope('org', 'a').get('org', 'doc')).toBeNull();
});

test('conditional updates and deletes reject a cross-profile replacement after a successful read', async () => {
 let row: any = { orgId: 'org', sk: 'DOC#doc', documentId: 'doc', businessProfileId: 'a', name: 'original' };
 const getItem = vi.fn(async () => ({ Item: { ...row } }));
 const update = vi.fn(async (_table, key, params) => {
  expect(key).toEqual({ orgId: 'org', sk: 'DOC#doc' });
  expect(params.ConditionExpression).toBe('attribute_exists(sk) AND businessProfileId = :profile');
  if (row?.businessProfileId !== params.ExpressionAttributeValues[':profile']) throw Object.assign(new Error('denied'), { name: 'ConditionalCheckFailedException' });
  row.name = params.ExpressionAttributeValues[':name']; return {};
 });
 const transactWrite = vi.fn(async operations => {
  const operation = operations[0].Delete;
  expect(operation.ConditionExpression).toBe('attribute_exists(sk) AND businessProfileId = :profile');
  if (row?.businessProfileId !== operation.ExpressionAttributeValues[':profile']) throw Object.assign(new Error('denied'), { name: 'TransactionCanceledException' });
  row = undefined; return {};
 });
 const repo = new DocumentRepo({ getItem, update, transactWrite } as unknown as IDdb).withScope('org', 'a');
 expect(await repo.get('org', 'doc')).not.toBeNull();
 row = { ...row, businessProfileId: 'b', name: 'foreign replacement' };
 await expect(repo.update('org', 'doc', { name: 'overwrite' })).rejects.toThrow('denied');
 await expect(repo.delete('org', 'doc')).rejects.toThrow('denied');
 expect(row.name).toBe('foreign replacement');
 row.businessProfileId = 'a';
 await repo.update('org', 'doc', { name: 'owned update' }); expect(row.name).toBe('owned update');
 await repo.delete('org', 'doc'); expect(row).toBeUndefined();
 await expect(repo.update('org', 'doc', { name: 'no upsert' })).rejects.toThrow('denied');
});

test('scoped create stamps immutable ownership and replay never adopts a foreign collision', async () => {
 const transactWrite = vi.fn().mockResolvedValue({}); const getItem = vi.fn();
 const repo = new DocumentRepo({ transactWrite, getItem } as unknown as IDdb).withScope('org', 'a');
 const input = { documentId: 'doc', name: 'File', description: '', category: 'general', s3Key: 'owned/file.pdf', createdBy: 'user' };
 const created = await repo.create('org', { ...input, orgId: 'forged', sk: 'forged', createdAt: 'forged' } as any);
 expect(created).toMatchObject({ orgId: 'org', businessProfileId: 'a', sk: 'DOC#doc' }); expect(created.createdAt).not.toBe('forged');
 await expect(repo.create('org', { ...input, businessProfileId: 'b' })).rejects.toThrow('mismatch'); expect(transactWrite).toHaveBeenCalledTimes(1);
 transactWrite.mockRejectedValue(Object.assign(new Error('collision'), { name: 'TransactionCanceledException' }));
 getItem.mockResolvedValue({ Item: created }); expect(await repo.create('org', input)).toEqual(created);
 getItem.mockResolvedValue({ Item: { ...created, businessProfileId: 'b' } }); await expect(repo.create('org', input)).rejects.toThrow('already exists');
 getItem.mockResolvedValue({ Item: { ...created, s3Key: 'other.pdf' } }); await expect(repo.create('org', input)).rejects.toThrow('already exists');
});
