import { expect, test, vi } from 'vitest';
import type { IDdb } from '../ddbPort';
import { OnboardingWorkflowRepo } from './repo';
const draft = { workflowId: 'wf-1', name: 'Email', isActive: true, activeVersion: 1, nodes: [], edges: [], createdAt: '2026-09-07', updatedAt: '2026-09-08', updatedBy: 'user-1' };
const conflict = { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] };

test('saving a draft and immutable version is one conditional transaction', async () => {
 const transactWrite = vi.fn().mockResolvedValue({});
 const repo = new OnboardingWorkflowRepo({ transactWrite } as unknown as IDdb);
 expect(await repo.saveVersion('org-1', draft, 1, 'save-1')).toEqual({ status: 'saved', version: 2 });
 const writes = transactWrite.mock.calls[0][0];
 expect(writes).toHaveLength(2);
 expect(writes[0].Put.Item).toMatchObject({ orgId: 'org-1', sk: 'WORKFLOW#wf-1', currentVersion: 2, activeVersion: 1 });
 expect(writes[0].Put.ConditionExpression).toContain('currentVersion = :expected');
 expect(writes[0].Put.ConditionExpression).toContain('activeVersion = :published');
 expect(writes[1].Put.Item).toMatchObject({ orgId: 'org-1', sk: 'VERSION#wf-1#000002', saveKey: 'save-1' });
 expect(writes[1].Put.ConditionExpression).toBe('attribute_not_exists(sk)');
});
test('same save retry is acknowledged, while stale or changed content conflicts', async () => {
 let saved: Record<string, unknown> | undefined;
 const transactWrite = vi.fn().mockImplementationOnce(async writes => { saved = writes[1].Put.Item; return {}; }).mockRejectedValue(conflict);
 const getItem = vi.fn().mockImplementation(async () => ({ Item: saved }));
 const repo = new OnboardingWorkflowRepo({ transactWrite, getItem } as unknown as IDdb);
 await repo.saveVersion('org-1', draft, 1, 'save-1');
 expect((await repo.saveVersion('org-1', draft, 1, 'save-1')).status).toBe('replayed');
 expect((await repo.saveVersion('org-1', { ...draft, name: 'Different' }, 1, 'save-1')).status).toBe('conflict');
 expect((await repo.saveVersion('org-1', draft, 1, 'save-2')).status).toBe('conflict');
 expect(getItem.mock.calls[0][2]).toEqual({ ConsistentRead: true });
});
test('publish requires the version to exist and the draft revision to remain unchanged', async () => {
 const transactWrite = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(conflict);
 const repo = new OnboardingWorkflowRepo({ transactWrite } as unknown as IDdb);
 expect(await repo.activateVersion('org-1', 'wf-1', 2, 'user-1', '2026-09-08')).toBe(true);
 const writes = transactWrite.mock.calls[0][0];
 expect(writes[0].ConditionCheck.Key).toEqual({ orgId: 'org-1', sk: 'VERSION#wf-1#000002' });
 expect(writes[1].Update.ConditionExpression).toBe('currentVersion = :version');
 expect(await repo.activateVersion('org-1', 'wf-1', 2, 'user-1', '2026-09-08')).toBe(false);
});
