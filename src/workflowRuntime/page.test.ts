import { expect, test, vi } from 'vitest';
import type { IDdb } from '../ddbPort';
import { WorkflowRuntimeRepo } from './repo';
import { OnboardingWorkflowRepo } from '../onboardingWorkflow/repo';
test('filtered run pages keep the continuation even when no matching rows are on this page', async () => {
 const query = vi.fn().mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { orgId: 'org-a', sk: 'WFRUN#20' } }).mockResolvedValue({ Items: [{ runId: '19' }] });
 const repo = new WorkflowRuntimeRepo({ query } as unknown as IDdb);
 const first = await repo.listRunsPage('org-a', { workflowId: 'wf', status: 'FAILED' });
 expect(first.items).toEqual([]); expect(first.nextToken).toBeTruthy();
 expect(query.mock.calls[0][0]).toMatchObject({ Limit: 20, FilterExpression: '#workflowId = :workflowId AND #status = :status', ExpressionAttributeValues: { ':org': 'org-a', ':workflowId': 'wf', ':status': 'FAILED' } });
 await repo.listRunsPage('org-a', { workflowId: 'wf', status: 'FAILED', nextToken: first.nextToken });
 expect(query.mock.calls[1][0].ExclusiveStartKey).toEqual({ orgId: 'org-a', sk: 'WFRUN#20' });
 await expect(repo.listRunsPage('org-b', { workflowId: 'wf', status: 'FAILED', nextToken: first.nextToken })).rejects.toThrow('page token');
 await expect(repo.listRunsPage('org-a', { workflowId: 'different', status: 'FAILED', nextToken: first.nextToken })).rejects.toThrow('page token');
 expect(query).toHaveBeenCalledTimes(2);
});
test('workflow search is applied in the database and version/log pages stay within their parent', async () => {
 const query = vi.fn().mockResolvedValue({ Items: [] }); const db = { query } as unknown as IDdb;
 const repo = new OnboardingWorkflowRepo(db);
 await repo.listPage('org', { search: 'Booking', isActive: false, limit: 5 });
 expect(query.mock.calls[0][0]).toMatchObject({ Limit: 5, ExpressionAttributeValues: { ':search': 'Booking', ':isActive': false } });
 expect(query.mock.calls[0][0].FilterExpression).toContain('contains(#name, :search)');
 await repo.listVersionsPage('org', 'wf');
 expect(query.mock.calls[1][0]).toMatchObject({ ExpressionAttributeValues: { ':prefix': 'VERSION#wf#', ':workflowId': 'wf' } });
 await new WorkflowRuntimeRepo(db).listExecutionLogsPage('org', 'run');
 expect(query.mock.calls[2][0]).toMatchObject({ ExpressionAttributeValues: { ':prefix': 'EXECLOG#run#', ':runId': 'run' } });
 await expect(repo.listPage('org', { nextToken: 'invalid' })).rejects.toThrow('page token');
 await expect(repo.listPage('org', { limit: 101 })).rejects.toThrow('limit');
});
test('log node filters execute in the database and cannot reuse another node or run token', async () => {
 const query = vi.fn().mockResolvedValue({ Items: [], LastEvaluatedKey: { orgId: 'org', sk: 'EXECLOG#run#020' } });
 const repo = new WorkflowRuntimeRepo({ query } as unknown as IDdb);
 const first = await repo.listExecutionLogsPage('org', 'run', { nodeId: 'email' });
 expect(first.items).toEqual([]); expect(first.nextToken).toBeTruthy();
 expect(query.mock.calls[0][0]).toMatchObject({ Limit: 20, FilterExpression: '#runId = :runId AND #nodeId = :nodeId', ExpressionAttributeValues: { ':runId': 'run', ':nodeId': 'email' } });
 await repo.listExecutionLogsPage('org', 'run', { nodeId: 'email', nextToken: first.nextToken });
 expect(query.mock.calls[1][0].ExclusiveStartKey).toEqual({ orgId: 'org', sk: 'EXECLOG#run#020' });
 for (const [org, run, nodeId] of [['org', 'run', 'sms'], ['org', 'other', 'email'], ['other', 'run', 'email']]) {
  await expect(repo.listExecutionLogsPage(org, run, { nodeId, nextToken: first.nextToken })).rejects.toThrow('page token');
 }
 expect(query).toHaveBeenCalledTimes(2);
});

test('durable step history reads the encoded checkpoint prefix with scoped node filtering', async () => {
 const query = vi.fn().mockResolvedValue({ Items: [{ nodeId: 'sms', status: 'DONE', outcome: { data: { smsMessageId: 'accepted' } } }] });
 const repo = new WorkflowRuntimeRepo({ query } as unknown as IDdb);
 const page = await repo.listStepsPage('org', 'wf#manual#one/two', { nodeId: 'sms', limit: 1 });
 expect(page.items[0].outcome).toEqual({ data: { smsMessageId: 'accepted' } });
 expect(query.mock.calls[0][0]).toMatchObject({ Limit: 1, ExpressionAttributeValues: { ':prefix': 'WFSTEP#wf%23manual%23one%2Ftwo#', ':runId': 'wf#manual#one/two', ':nodeId': 'sms' } });
});
