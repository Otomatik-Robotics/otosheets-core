import { beforeEach, expect, test, vi } from 'vitest';
import type { IDdb } from '../ddbPort';
import { WorkflowRuntimeRepo } from './repo';
import { inputSubmissionFingerprint, mergeWorkflowAnswers } from './input';
const db = { getItem: vi.fn(), transactWrite: vi.fn() };
const repo = new WorkflowRuntimeRepo(db as unknown as IDdb);
const request = { requestId: 'request-1', nodeId: 'document', requestedAt: '2026-09-07', fields: [{ path: 'person.name', type: 'string' as const }, { path: 'salary', type: 'number' as const }] };
const submission = { requestId: 'request-1', submissionKey: 'submit-1', actorUserId: 'actor', answers: { 'person.name': 'Sam', salary: 0 } };
const run = { orgId: 'org', runId: 'run', workflowId: 'wf', workflowVersion: 2, status: 'WAITING_FOR_INPUT', inputRequest: request, input: { person: { id: 'person-1' }, runKey: 'original', keep: false } };
beforeEach(() => { vi.resetAllMocks(); process.env.ONBOARDING_TABLE = 'test'; });
test('answers preserve unrelated nested input, zero, false, and authenticated scope', () => {
 const result = mergeWorkflowAnswers(run.input, request, submission.answers);
 expect(result).toEqual({ person: { id: 'person-1', name: 'Sam' }, salary: 0, runKey: 'original', keep: false });
 expect(run.input.person).toEqual({ id: 'person-1' });
 expect(mergeWorkflowAnswers({}, { ...request, fields: [{ path: 'enabled', type: 'string' }] }, { enabled: false })).toEqual({ enabled: false });
});
test.each(['orgId', 'nested.__proto__.value', 'userId', 'constructor.name', 'runKey'])('refuses protected request path %s', path => {
 expect(() => mergeWorkflowAnswers({}, { ...request, fields: [{ path, type: 'string' }] }, { [path]: 'changed' })).toThrow('Protected');
});
test('refuses extra answers, missing answers, blank or wrongly typed values and destructive parent replacements', () => {
 for (const answers of [{ ...submission.answers, other: 'x' }, { salary: 1 }, { ...submission.answers, salary: '0' }, { ...submission.answers, 'person.name': ' ' }]) {
  expect(() => mergeWorkflowAnswers(run.input, request, answers)).toThrow();
 }
 expect(() => mergeWorkflowAnswers({ person: 'original' }, request, submission.answers)).toThrow('conflicts');
 expect(() => mergeWorkflowAnswers({ person: { id: 'keep' } }, { ...request, fields: [{ path: 'person', type: 'string' }] }, { person: 'replace' })).toThrow('conflicts');
 expect(() => inputSubmissionFingerprint({ ...submission, answers: { salary: Number.NaN } })).toThrow();
});
test('atomically records answers and one continuation while preserving completed steps', async () => {
 db.getItem.mockResolvedValueOnce({}).mockResolvedValueOnce({ Item: run });
 expect(await repo.submitInputs('org', 'run', submission, 1000)).toBe('resolved');
 const ops = db.transactWrite.mock.calls[0][0];
 expect(ops).toHaveLength(4);
 expect(ops[0].Update).toMatchObject({ Key: { orgId: 'org', sk: 'WFRUN#run' }, ExpressionAttributeValues: { ':waiting': 'WAITING_FOR_INPUT', ':version': 2, ':input': { person: { id: 'person-1', name: 'Sam' }, salary: 0, runKey: 'original' } } });
 expect(ops[0].Update.ConditionExpression).toContain('leaseUntil <= :now');
 expect(ops[1].ConditionCheck).toMatchObject({ Key: { orgId: 'org', sk: 'WFSTEP#run#document' }, ConditionExpression: 'attribute_not_exists(sk)' });
 expect(ops[2].Put.Item).toMatchObject({ actorUserId: 'actor', fields: ['person.name', 'salary'] });
 expect(ops[2].Put.Item).not.toHaveProperty('answers');
 expect(ops[3].Put.Item).toMatchObject({ workflowVersion: 2, kind: 'wait', dueBucket: 'workflow', dueAt: '1970-01-01T00:00:01.000Z' });
 expect(ops.every((op: Record<string, unknown>) => !op.Delete)).toBe(true);
});
test('unchanged lost-response submissions replay regardless of key order; changed submissions conflict', async () => {
 db.getItem.mockResolvedValue({ Item: { fingerprint: inputSubmissionFingerprint(submission) } });
 expect(await repo.submitInputs('org', 'run', { ...submission, answers: { salary: 0, 'person.name': 'Sam' } })).toBe('replayed');
 expect(await repo.submitInputs('org', 'run', { ...submission, answers: { ...submission.answers, salary: 1 } })).toBe('conflict');
 expect(db.transactWrite).not.toHaveBeenCalled();
});
test('stale requests and transaction races cannot alter a run or schedule another continuation', async () => {
 db.getItem.mockImplementation(async (_table, key) => ({ Item: key.sk === 'WFRUN#run' ? run : undefined }));
 expect(await repo.submitInputs('org', 'run', { ...submission, requestId: 'stale' })).toBe('conflict');
 expect(db.transactWrite).not.toHaveBeenCalled();
 db.transactWrite.mockRejectedValue({ name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] });
 expect(await repo.submitInputs('org', 'run', submission)).toBe('conflict');
 db.transactWrite.mockRejectedValue(new Error('unavailable'));
 await expect(repo.submitInputs('org', 'run', submission)).rejects.toThrow('unavailable');
});
