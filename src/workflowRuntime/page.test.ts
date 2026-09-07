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
