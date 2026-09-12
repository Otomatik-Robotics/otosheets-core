import { expect, test, vi } from 'vitest';
import { ConversationRepo } from './repo';
import type { IDdb } from '../ddbPort';
test('chat pagination filters user, org and channel before returning summaries', async () => {
 const query = vi.fn().mockResolvedValue({ Items: [], LastEvaluatedKey: { userId: 'user-1', conversationId: 'chat-1' } });
 const repo = new ConversationRepo({ query } as unknown as IDdb);
 const page = await repo.listConversationsPage('user-1', { organizationId: 'org-1', limit: 2 });
 expect(query).toHaveBeenCalledWith(expect.objectContaining({ KeyConditionExpression: 'userId = :userId', FilterExpression: expect.stringContaining('organizationId = :orgId AND'), ExpressionAttributeValues: expect.objectContaining({ ':userId': 'user-1', ':orgId': 'org-1' }), Limit: 2 }));
 expect(query.mock.calls[0][0].ProjectionExpression).not.toContain('messages');
 await repo.listConversationsPage('user-1', { organizationId: 'org-1', nextToken: page.nextToken });
 expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ ExclusiveStartKey: { userId: 'user-1', conversationId: 'chat-1' } }));
 for (const scope of [{ organizationId: 'org-2' }]) await expect(repo.listConversationsPage('user-1', { ...scope, nextToken: page.nextToken })).rejects.toThrow('Invalid conversation nextToken');
 await expect(repo.listConversationsPage('user-2', { organizationId: 'org-1', nextToken: page.nextToken })).rejects.toThrow('Invalid conversation nextToken');
 expect(query).toHaveBeenCalledTimes(2);
});
