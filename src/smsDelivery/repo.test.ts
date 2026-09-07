import { beforeEach, expect, test, vi } from 'vitest';
import type { IDdb } from '../ddbPort';
import { SmsDeliveryRepo } from './repo';
const db = { getItem: vi.fn(), transactWrite: vi.fn() };
const repo = new SmsDeliveryRepo(db as unknown as IDdb);
beforeEach(() => { vi.resetAllMocks(); process.env.MESSAGES_TABLE = 'messages-test'; });
test('request claims are conditional and tenant/actor scoped', async () => {
 db.transactWrite.mockResolvedValueOnce({}).mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' });
 expect(await repo.begin('org-a', 'actor', 'request', 'body')).toBe(true);
 expect(await repo.begin('org-a', 'actor', 'request', 'body')).toBe(false);
 expect(db.transactWrite.mock.calls[0][0][0].Put).toMatchObject({ Item: { conversationId: 'SMSREQUEST#org-a', actorUserId: 'actor', status: 'STARTED' }, ConditionExpression: 'attribute_not_exists(messageId)' });
});
test('accepted result and message are recorded atomically', async () => {
 await repo.finish('org-a', 'actor', 'request', 'body', { status: 'ACCEPTED', providerMessageId: 'sns-id' }, { conversationId: 'conversation', messageId: 'message', orgId: 'other' });
 const ops = db.transactWrite.mock.calls[0][0];
 expect(ops).toHaveLength(2);
 expect(ops[0].Put.ConditionExpression).toContain('#status = :started');
 expect(ops[1].Put.Item).toMatchObject({ orgId: 'org-a', provider: 'sns', providerMessageId: 'sns-id' });
});
test('does not report acceptance without a provider ID', async () => {
 await expect(repo.finish('org-a', 'actor', 'request', 'body', { status: 'ACCEPTED' })).rejects.toThrow('provider ID');
 expect(db.transactWrite).not.toHaveBeenCalled();
});
