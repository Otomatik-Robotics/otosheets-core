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


describe('delivery review', () => {
    const review = { reviewKey: 'review-1', nodeId: 'email', expectedOwner: 'attempt-1', expectedStartedAt: 123, decision: 'retry' as const, actorUserId: 'owner-1', note: 'Provider confirms no send', confirmedNotDelivered: true };
    const run = { orgId: 'org-a', runId: 'r1', workflowId: 'w1', workflowVersion: 2, status: 'NEEDS_REVIEW' };
    it('atomically releases the reviewed step, records its actor and schedules the pinned run', async () => {
        db.getItem.mockResolvedValueOnce({}).mockResolvedValueOnce({ Item: run });
        db.transactWrite.mockResolvedValue({});
        expect(await repo.resolveDeliveryReview('org-a', 'r1', review, 1000)).toBe('resolved');
        const ops = db.transactWrite.mock.calls[0][0];
        expect(ops).toHaveLength(4);
        expect(ops[0].Update.ConditionExpression).toContain('#status = :needsReview');
        expect(ops[0].Update.ConditionExpression).toContain('#nodes.#node = :paused');
        expect(ops[1].Delete).toMatchObject({ Key: { orgId: 'org-a' }, ExpressionAttributeValues: { ':started': 'STARTED', ':owner': 'attempt-1', ':startedAt': 123 } });
        expect(ops[2].Put.Item).toMatchObject({ orgId: 'org-a', actorUserId: 'owner-1', decision: 'retry', note: review.note });
        expect(ops[3].Put.Item).toMatchObject({ orgId: 'org-a', workflowVersion: 2, kind: 'wait', dueBucket: 'workflow' });
    });
    it('replays the same decision after a lost response, but refuses changed decisions', async () => {
        const fingerprint = JSON.stringify(['email', 'attempt-1', 123, 'retry', 'owner-1', review.note, true, 'STARTED']);
        db.getItem.mockResolvedValue({ Item: { fingerprint } });
        expect(await repo.resolveDeliveryReview('org-a', 'r1', review)).toBe('replayed');
        expect(await repo.resolveDeliveryReview('org-a', 'r1', { ...review, decision: 'stop' })).toBe('conflict');
        expect(db.transactWrite).not.toHaveBeenCalled();
    });
    it('stops without removing the delivery checkpoint or creating a wake', async () => {
        db.getItem.mockResolvedValueOnce({}).mockResolvedValueOnce({ Item: run });
        db.transactWrite.mockResolvedValue({});
        expect(await repo.resolveDeliveryReview('org-a', 'r1', { ...review, decision: 'stop' })).toBe('resolved');
        const ops = db.transactWrite.mock.calls[0][0];
        expect(ops).toHaveLength(3);
        expect(ops[0].Update.ExpressionAttributeValues[':status']).toBe('FAILED');
        expect(ops[1].ConditionCheck).toBeDefined();
    });
    it('resumes a saved delivery result without deleting it or resending', async () => {
        db.getItem.mockResolvedValueOnce({}).mockResolvedValueOnce({ Item: run });
        db.transactWrite.mockResolvedValue({});
        expect(await repo.resolveDeliveryReview('org-a', 'r1', { ...review, decision: 'resume', expectedStatus: 'DONE' })).toBe('resolved');
        const ops = db.transactWrite.mock.calls[0][0];
        expect(ops).toHaveLength(4);
        expect(ops[1].Delete).toBeUndefined();
        expect(ops[1].ConditionCheck.ExpressionAttributeValues[':started']).toBe('DONE');
        expect(ops[1].ConditionCheck.ConditionExpression).toContain('attribute_exists(outcome)');
        await expect(repo.resolveDeliveryReview('org-a', 'r1', { ...review, expectedStatus: 'DONE' })).rejects.toThrow('Invalid workflow delivery review');
    });
    it('refuses a retry without explicit non-delivery confirmation before accessing storage', async () => {
        await expect(repo.resolveDeliveryReview('org-a', 'r1', { ...review, confirmedNotDelivered: false })).rejects.toThrow('Invalid workflow delivery review');
        expect(db.getItem).not.toHaveBeenCalled();
        expect(db.transactWrite).not.toHaveBeenCalled();
    });
    it('reports a stale or raced attempt as conflict and preserves service failures', async () => {
        db.getItem.mockImplementation(async (_table, key) => ({ Item: key.sk === 'WFRUN#r1' ? run : undefined }));
        db.transactWrite.mockRejectedValue({ name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] });
        expect(await repo.resolveDeliveryReview('org-a', 'r1', review)).toBe('conflict');
        db.transactWrite.mockRejectedValue(new Error('service unavailable'));
        await expect(repo.resolveDeliveryReview('org-a', 'r1', review)).rejects.toThrow('service unavailable');
    });
});
