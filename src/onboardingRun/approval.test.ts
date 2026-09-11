import { expect, test, vi } from 'vitest';
import type { IDdb } from '../ddbPort';
import { WorkflowApprovalRepo } from './repo';

const approval = { orgId: 'org-1', approvalId: 'a1', runId: 'r1', workflowId: 'w1', workflowName: 'Contract', nodeId: 'n1', status: 'pending' as const, requestedAt: '2026-09-07T00:00:00Z', requestedBy: 'user-1', assignedTo: ['m1'] };
test('creates approvals conditionally and treats a duplicate as a no-op', async () => {
 const transactWrite = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce({ name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] });
 const repo = new WorkflowApprovalRepo({ transactWrite } as unknown as IDdb);
 expect(await repo.create(approval)).toBe(true);
 expect(await repo.create(approval)).toBe(false);
 expect(transactWrite.mock.calls[0][0][0].Put.ConditionExpression).toBe('attribute_not_exists(sk)');
});
test('decides only pending, assigned and unexpired approvals in the requested organisation', async () => {
 const transactWrite = vi.fn().mockResolvedValue({});
 const repo = new WorkflowApprovalRepo({ transactWrite } as unknown as IDdb);
 await repo.decide('org-1', 'a1', 'm1', 'user-1', 'approved', '2026-09-07T00:00:00Z');
 const command = transactWrite.mock.calls[0][0][0].Update;
 expect(command.Key).toEqual({ orgId: 'org-1', sk: 'APPROVAL#a1' });
 expect(command.ConditionExpression).toContain('contains(assignedTo, :member)');
 expect(command.ConditionExpression).toContain('expiresAt > :now');
 expect(command.ExpressionAttributeValues[':pending']).toBe('pending');
});
test('pages approvals in the database and rejects another tenant pagination token', async () => {
 const query = vi.fn().mockResolvedValue({ Items: [approval], LastEvaluatedKey: { orgId: 'org-1', sk: 'APPROVAL#a1' } });
 const repo = new WorkflowApprovalRepo({ query } as unknown as IDdb);
 const page = await repo.listPendingPage('org-1', 'm1');
 expect(query.mock.calls[0][0].Limit).toBe(20);
 expect(query.mock.calls[0][0].FilterExpression).toContain('contains(assignedTo, :member)');
 await expect(repo.listPendingPage('org-2', 'm1', page.nextToken)).rejects.toThrow('Invalid nextToken');
});
