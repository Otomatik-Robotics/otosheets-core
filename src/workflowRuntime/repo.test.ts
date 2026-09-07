import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IDdb } from '../ddbPort';
import { WorkflowRuntimeRepo, WorkflowDueRepo } from './repo';
const db = { getItem: vi.fn(), update: vi.fn(), transactWrite: vi.fn(), query: vi.fn() };
const repo = new WorkflowRuntimeRepo(db as unknown as IDdb);
beforeEach(() => { vi.resetAllMocks(); process.env.ONBOARDING_TABLE = 'workflow-test'; });

describe('tenant workflow runtime', () => {
    it('claims a run conditionally and keeps scope outside caller data', async () => {
        db.transactWrite.mockResolvedValueOnce({}).mockRejectedValueOnce({ name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] });
        const run = { runId: 'r1', workflowId: 'w1', status: 'IN_PROGRESS', orgId: 'other' };
        expect(await repo.create('org-a', run)).toBe(true);
        expect(await repo.create('org-a', run)).toBe(false);
        expect(db.transactWrite.mock.calls[0][0][0].Put).toMatchObject({ Item: { orgId: 'org-a', sk: 'WFRUN#r1' }, ConditionExpression: 'attribute_not_exists(sk)' });
    });
    it('does not mistake a transaction service failure for a duplicate', async () => {
        db.transactWrite.mockRejectedValue({ name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ProvisionedThroughputExceeded' }] });
        await expect(repo.create('org-a', { runId: 'r' })).rejects.toMatchObject({ name: 'TransactionCanceledException' });
    });
    it('atomically persists a waiting step and tenant-owned wake', async () => {
        db.transactWrite.mockResolvedValue({});
        await repo.wait('org-a', 'r1', 'n1', 'lease1', { orgId: 'org-a', runId: 'r1', workflowId: 'w1', wakeId: 'wake1', dueAt: '2026-09-09T09:00:00Z' });
        const operations = db.transactWrite.mock.calls[0][0];
        expect(operations).toHaveLength(3);
        expect(operations[0].ConditionCheck).toMatchObject({ Key: { orgId: 'org-a', sk: 'WFRUN#r1' }, ConditionExpression: 'leaseOwner = :owner' });
        for (const operation of operations.slice(1)) expect(operation.Put.Item.orgId).toBe('org-a');
        expect(operations[2].Put.Item).toMatchObject({ sk: 'WFWAKE#wake1', dueBucket: 'workflow' });
    });
    it('rejects a wake referring to another organisation before any write', async () => {
        await expect(repo.wait('org-a', 'r1', 'n1', 'lease', { orgId: 'org-b', runId: 'r1', workflowId: 'w1', wakeId: 'wake', dueAt: '2026-09-09T09:00:00Z' })).rejects.toThrow('scope');
        expect(db.transactWrite).not.toHaveBeenCalled();
    });
    it('fences step completion with the active run lease', async () => {
        db.transactWrite.mockResolvedValue({});
        await repo.finishStep('org-a', 'r1', 'n1', 'lease2', { status: 'done', message: 'Sent' });
        expect(db.transactWrite.mock.calls[0][0][0].ConditionCheck.ExpressionAttributeValues).toEqual({ ':owner': 'lease2' });
    });
    it('reads run and step data consistently under the requested organisation', async () => {
        db.getItem.mockResolvedValue({});
        await repo.get('org-a', 'r1'); await repo.getStep('org-a', 'r1', 'n1');
        expect(db.getItem.mock.calls.every(call => call[1].orgId === 'org-a' && call[2].ConsistentRead === true)).toBe(true);
    });
});

describe('due metadata discovery', () => {
    it('uses the sparse due index and returns only locators', async () => {
        db.query.mockResolvedValue({ Items: [{ orgId: 'org-a', wakeId: 'wake1', dueAt: '2026-09-09T09:00:00Z', accidentalContent: 'private' }] });
        const result = await new WorkflowDueRepo(db as unknown as IDdb).listDue('2026-09-09T09:01:00Z');
        expect(db.query.mock.calls[0][0]).toMatchObject({ IndexName: 'workflow-due-index', Limit: 20 });
        expect(result.items).toEqual([{ tenantOrgId: 'org-a', wakeId: 'wake1', dueAt: '2026-09-09T09:00:00Z' }]);
    });
});
