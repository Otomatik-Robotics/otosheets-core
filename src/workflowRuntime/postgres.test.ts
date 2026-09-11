import { beforeAll, beforeEach, afterAll, expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync } from 'fs';
import type { PgDb } from '../pg/client';
import { OnboardingWorkflowPgRepo } from '../onboardingWorkflow/repo.pg';
import { WorkflowRuntimePgRepo, WorkflowDuePgRepo } from './repo.pg';
import { WorkflowApprovalPgRepo } from '../onboardingRun/approval.pg';
import { WorkflowMigrationRepo } from './migration';
import { workflowStorageMode, resetWorkflowStorageCache } from './storage';
let pg: PGlite, db: PgDb;
let definitions: OnboardingWorkflowPgRepo, runtime: WorkflowRuntimePgRepo, due: WorkflowDuePgRepo, approvals: WorkflowApprovalPgRepo;
const org = 'org-1';
const definition = { workflowId: 'wf', name: 'Test workflow', isActive: false, nodes: [], edges: [], createdBy: 'owner', updatedBy: 'owner', createdAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z' };
const run = (runId = 'run', extra: Record<string, unknown> = {}) => ({ orgId: org, runId, workflowId: 'wf', workflowVersion: 1, status: 'IN_PROGRESS' as const, startedAt: '2026-09-08T00:00:00Z', input: {}, ...extra });
const wake = (wakeId = 'wake') => ({ orgId: org, wakeId, runId: 'run', workflowId: 'wf', workflowVersion: 1, dueAt: '2026-09-08T01:00:00.000Z', kind: 'wait' as const });
beforeAll(async () => {
    pg = new PGlite();
    const migration = readFileSync('drizzle/0054_workflow_storage.sql', 'utf8') + '\n--> statement-breakpoint\n' + readFileSync('drizzle/0055_workflow_business_profiles.sql', 'utf8');
    for (let repeat = 0; repeat < 2; repeat++) for (const statement of migration.split('--> statement-breakpoint')) await pg.exec(statement);
    db = drizzle(pg) as unknown as PgDb;
    definitions = new OnboardingWorkflowPgRepo(db); runtime = new WorkflowRuntimePgRepo(db); due = new WorkflowDuePgRepo(db); approvals = new WorkflowApprovalPgRepo(db);
});
beforeEach(async () => { await pg.exec('TRUNCATE workflow_definitions, workflow_versions, workflow_runs, workflow_steps, workflow_wakes, workflow_approvals, workflow_audit'); });
afterAll(async () => { await pg.close(); });

test('save versions atomically, replay the same save, and reject a competing edit', async () => {
    const results = await Promise.all([definitions.saveVersion(org, definition, 0, 'one'), definitions.saveVersion(org, { ...definition, name: 'Other' }, 0, 'two')]);
    expect(results.map(r => r.status).sort()).toEqual(['conflict', 'saved']);
    expect(await definitions.saveVersion(org, definition, 0, 'one')).toEqual({ status: 'replayed', version: 1 });
    expect(await definitions.getVersion('org-other', 'wf', 1)).toBeNull();
    expect(await definitions.activateVersion(org, 'wf', 1, 'owner', '2026-09-08')).toBe(true);
    expect(await definitions.saveVersion(org, definition, 1, 'stale')).toMatchObject({ status: 'conflict' });
    expect(await definitions.saveVersion(org, { ...definition, activeVersion: 1 }, 1, 'next')).toMatchObject({ status: 'saved', version: 2 });
    expect(await definitions.activateVersion(org, 'wf', 1, 'owner', '2026-09-08')).toBe(false);
    expect((await definitions.listVersionsPage(org, 'wf')).items.map(v => v.version)).toEqual([2, 1]);
});

test('definition search and status filters execute before pagination', async () => {
    for (let i = 0; i < 5; i++) await definitions.put(org, { ...definition, workflowId: String(i), name: i === 0 ? 'Needle' : 'Other', isActive: i === 0 });
    expect((await definitions.listPage(org, { search: 'needle', isActive: true, limit: 1 })).items.map(w => w.workflowId)).toEqual(['0']);
    expect(await definitions.countByOrg(org)).toBe(5);
});

test('run claims are exclusive; an old worker cannot finish after a new claim', async () => {
    expect(await runtime.create(org, run())).toBe(true); expect(await runtime.create(org, run())).toBe(false);
    const claims = await Promise.all([runtime.acquire(org, 'run', 'a', 1000, 100), runtime.acquire(org, 'run', 'b', 1000, 100)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await runtime.acquire(org, 'run', 'new', 1200, 100);
    await expect(runtime.finish(org, 'run', 'a', run())).rejects.toThrow('conditional');
    expect(await runtime.startStep(org, 'run', 'email', 'a')).toBe(false);
    expect(await runtime.startStep(org, 'run', 'email', 'new')).toBe(true);
    expect(await runtime.startStep(org, 'run', 'email', 'new')).toBe(false);
    await runtime.finishStep(org, 'run', 'email', 'new', { status: 'done', data: { messageId: 'sent-once' } });
    await runtime.finish(org, 'run', 'new', run('run', { status: 'COMPLETED' }));
    expect(await runtime.acquire(org, 'run', 'again', 2000, 100)).toBeNull();
    expect(await runtime.get('org-other', 'run')).toBeNull(); expect(await runtime.getStep('org-other', 'run', 'email')).toBeNull();
});

test('wait atomically records a step and wake; invalid writes leave no wake', async () => {
    await runtime.create(org, run()); await runtime.acquire(org, 'run', 'owner', 1000, 100);
    await expect(runtime.wait(org, 'run', 'missing', 'owner', wake())).rejects.toThrow('conditional');
    expect(await runtime.getWake(org, 'wake')).toBeNull();
    await runtime.startStep(org, 'run', 'wait', 'owner'); await runtime.wait(org, 'run', 'wait', 'owner', wake());
    expect(await runtime.getStep(org, 'run', 'wait')).toMatchObject({ status: 'WAITING' });
    expect(await runtime.putWake(org, wake())).toBe(false);
    await expect(runtime.putWake('org-other', wake())).rejects.toThrow('organisation');
    await runtime.removeWake(wake()); expect(await runtime.getWake(org, 'wake')).toBeNull();
});

test('run history is chronological, scoped, and filters before paging', async () => {
    for (let i = 0; i < 7; i++) await runtime.create(org, run(`r${i}`, { startedAt: `2026-09-08T00:0${i}:00Z`, status: i % 2 ? 'PAUSED' : 'COMPLETED' }));
    const one = await runtime.listRunsPage(org, { status: 'COMPLETED', limit: 2 }); expect(one.items.map(r => r.runId)).toEqual(['r6', 'r4']);
    const two = await runtime.listRunsPage(org, { status: 'COMPLETED', limit: 2, nextToken: one.nextToken }); expect(two.items.map(r => r.runId)).toEqual(['r2', 'r0']);
    await expect(runtime.listRunsPage('org-other', { status: 'COMPLETED', nextToken: one.nextToken })).rejects.toThrow('nextToken');
    await expect(runtime.listRunsPage(org, { status: 'PAUSED', nextToken: one.nextToken })).rejects.toThrow('nextToken');
});

test('due metadata pages across tenants without exposing run inputs', async () => {
    await runtime.putWake(org, wake('a')); await runtime.putWake('org-2', { ...wake('b'), orgId: 'org-2' });
    const first = await due.listDue('2026-09-08T01:00:01Z', undefined, 1); expect(first.items).toEqual([{ tenantOrgId: org, wakeId: 'a', dueAt: wake().dueAt }]);
    const second = await due.listDue('2026-09-08T01:00:01Z', first.nextToken, 1); expect(second.items[0].tenantOrgId).toBe('org-2'); expect(second.nextToken).toBeUndefined();
});

test('approvals enforce tenant, assignee, expiry and one recorded decision', async () => {
    const a = { orgId: org, approvalId: 'a', runId: 'run', nodeId: 'approval', workflowId: 'wf', workflowName: 'Test', assignedTo: ['member'], requestedAt: '2026-09-08', requestedBy: 'owner', status: 'pending' as const, expiresAt: '2099-01-01' };
    expect(await approvals.create(a)).toBe(true); expect(await approvals.create(a)).toBe(false);
    expect((await approvals.listPendingPage(org, 'member')).approvals).toHaveLength(1); expect((await approvals.listPendingPage(org, 'other')).approvals).toHaveLength(0);
    expect(await approvals.decide('org-other', 'a', 'member', 'user', 'approved', '2026-09-08')).toBe(false);
    expect(await approvals.decide(org, 'a', 'other', 'user', 'approved', '2026-09-08')).toBe(false);
    expect(await approvals.decide(org, 'a', 'member', 'user', 'approved', '2026-09-08')).toBe(true);
    expect(await approvals.decide(org, 'a', 'member', 'user', 'rejected', '2026-09-08')).toBe(false);
    await approvals.create({ ...a, approvalId: 'expired', expiresAt: '2026-09-07' }); expect(await approvals.decide(org, 'expired', 'member', 'user', 'approved', '2026-09-08')).toBe(false); expect(await approvals.expire(org, 'expired', '2026-09-08')).toBe(true);
});

test('input submission records one atomic continuation and rejects a changed replay', async () => {
    await runtime.create(org, run('run', { status: 'WAITING_FOR_INPUT', inputRequest: { requestId: 'request', nodeId: 'email', requestedAt: '2026-09-08', fields: [{ path: 'name', type: 'string' }] } }));
    const submission = { requestId: 'request', submissionKey: 'answer', actorUserId: 'owner', answers: { name: 'Leon' } };
    expect(await runtime.submitInputs(org, 'run', submission)).toBe('resolved'); expect(await runtime.submitInputs(org, 'run', submission)).toBe('replayed');
    expect(await runtime.submitInputs(org, 'run', { ...submission, answers: { name: 'Other' } })).toBe('conflict');
    expect(await runtime.get(org, 'run')).toMatchObject({ status: 'PAUSED', input: { name: 'Leon' } });
    expect((await due.listDue('2099-01-01')).items).toHaveLength(1);
});

test('delivery review resets only the reviewed step and deduplicates the wake', async () => {
    await runtime.create(org, run()); await runtime.acquire(org, 'run', 'worker', 1000, 100); await runtime.startStep(org, 'run', 'email', 'worker');
    const started = (await runtime.getStep(org, 'run', 'email'))!;
    await runtime.finish(org, 'run', 'worker', run('run', { status: 'NEEDS_REVIEW', nodeStatuses: { email: 'paused' } }));
    const review = { reviewKey: 'review', nodeId: 'email', expectedOwner: 'worker', expectedStartedAt: started.startedAt!, decision: 'retry' as const, actorUserId: 'owner', note: 'Provider confirms no delivery', confirmedNotDelivered: true };
    expect(await runtime.resolveDeliveryReview(org, 'run', review)).toBe('resolved'); expect(await runtime.resolveDeliveryReview(org, 'run', review)).toBe('replayed');
    expect(await runtime.getStep(org, 'run', 'email')).toBeNull(); expect((await due.listDue('2099-01-01')).items).toHaveLength(1);
});

test('migration preserves definitions, versions, run leases, steps, wakes and audit payloads exactly', async () => {
    const migration = new WorkflowMigrationRepo({} as any, db);
    const records = [
        { ...definition, orgId: org, sk: 'WORKFLOW#wf', currentVersion: 1, activeVersion: 1 },
        { orgId: org, sk: 'VERSION#wf#000001', workflowId: 'wf', version: 1, nodes: [], edges: [], fingerprint: 'keep' },
        { ...run(), sk: 'WFRUN#run', leaseOwner: 'keep', leaseUntil: 123 },
        { orgId: org, sk: 'WFSTEP#run#email', runId: 'run', nodeId: 'email', status: 'DONE', outcome: { data: { messageId: 'keep' } } },
        { ...wake(), sk: 'WFWAKE#wake', dueBucket: 'workflow' },
        { orgId: org, sk: 'WFREVIEW#run#review', runId: 'run', fingerprint: 'keep' },
        { orgId: org, sk: 'WFINPUT#run#input', runId: 'run', fingerprint: 'keep' },
        { orgId: org, sk: 'EXECLOG#run#email', runId: 'run', nodeId: 'email', status: 'succeeded' },
        { orgId: org, sk: 'APPROVAL#a', approvalId: 'a', runId: 'run', status: 'pending', assignedTo: ['member'], requestedAt: '2026-09-08' },
    ];
    for (const record of records) { await migration.importRecord(record); await migration.importRecord(record); expect(await migration.importedRecord(record)).toEqual(record); }
    await expect(migration.importRecord({ orgId: org, sk: 'WELCOME_EMAIL#x' })).rejects.toThrow('outside');
});

test('maintenance fails closed and explicit Postgres mode avoids Dynamo fallback', async () => {
    const before = process.env.DATA_BACKEND_WORKFLOWS;
    try { resetWorkflowStorageCache(); process.env.DATA_BACKEND_WORKFLOWS = 'maintenance'; await expect(workflowStorageMode()).rejects.toThrow('migration'); process.env.DATA_BACKEND_WORKFLOWS = 'pg'; expect(await workflowStorageMode()).toBe('pg'); process.env.DATA_BACKEND_WORKFLOWS = 'dual_pg'; await expect(workflowStorageMode()).rejects.toThrow('Invalid'); }
    finally { if (before === undefined) delete process.env.DATA_BACKEND_WORKFLOWS; else process.env.DATA_BACKEND_WORKFLOWS = before; resetWorkflowStorageCache(); }
});

test('profile filters precede pagination and tokens cannot cross profiles under the same org', async () => {
    for (const id of ['a1', 'b1', 'a2']) {
        const businessProfileId = id[0];
        await definitions.saveVersion(org, { ...definition, workflowId: id, businessProfileId }, 0, id);
        await runtime.create(org, run(id, { workflowId: id, businessProfileId }));
    }
    const first = await definitions.listPage(org, { businessProfileId: 'a', limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.items[0].businessProfileId).toBe('a');
    await expect(definitions.listPage(org, { businessProfileId: 'b', nextToken: first.nextToken })).rejects.toThrow('nextToken');
    expect((await definitions.listVersionsPage(org, 'a1', { businessProfileId: 'b' })).items).toEqual([]);
    expect((await runtime.listRunsPage(org, { businessProfileId: 'b' })).items.map(r => r.runId)).toEqual(['b1']);
    expect(await definitions.saveVersion(org, { ...definition, workflowId: 'a1', businessProfileId: 'b' }, 1, 'steal')).toMatchObject({ status: 'conflict' });
});
