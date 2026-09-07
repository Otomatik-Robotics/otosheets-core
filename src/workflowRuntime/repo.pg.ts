import { and, eq, lt, lte, or, desc, asc, sql } from 'drizzle-orm';
import { getPgTx, type PgDb } from '../pg/client';
import { workflowRuns as runs, workflowSteps as steps, workflowWakes as wakes, workflowAudit as audit } from '../pg/schema/workflows';
import { clean, workflowScope, workflowConflict, lockedRun, runRow, writeRun, insertWake, pageLimit, pageToken, nextPage, runWhere } from './pgHelpers';
import { inputSubmissionFingerprint, mergeWorkflowAnswers, type WorkflowInputSubmission } from './input';
import type { WorkflowPageOptions } from './page';
import type { WorkflowRuntimeRun, WorkflowRuntimeStep, WorkflowWake, WorkflowDeliveryReview, IWorkflowRuntimeRepo, IWorkflowDueRepo } from './repo';
const stepWhere = (orgId: string, runId: string, nodeId: string) => and(eq(steps.orgId, workflowScope(orgId)), eq(steps.runId, runId), eq(steps.nodeId, nodeId));
const auditWhere = (orgId: string, id: string) => and(eq(audit.orgId, workflowScope(orgId)), eq(audit.recordId, id));
const stepRow = (orgId: string, runId: string, nodeId: string, value: Record<string, unknown>) => ({ orgId, runId, nodeId, payload: clean({ ...value, orgId, runId, nodeId, sk: `WFSTEP#${encodeURIComponent(runId)}#${encodeURIComponent(nodeId)}` }) });
export class WorkflowRuntimePgRepo implements IWorkflowRuntimeRepo {
    constructor(private readonly injected?: PgDb) {}
    private get db() { return this.injected ?? getPgTx(); }
    async get(orgId: string, runId: string): Promise<WorkflowRuntimeRun | null> { return (await this.db.select().from(runs).where(runWhere(orgId, runId)))[0]?.payload as WorkflowRuntimeRun ?? null; }
    async create(orgId: string, run: Omit<WorkflowRuntimeRun, 'orgId'> & { runId: string }): Promise<boolean> { return (await this.db.insert(runs).values(runRow(orgId, { ...run, ttl: run.ttl ?? Math.floor(Date.now() / 1000) + 455 * 86400 })).onConflictDoNothing().returning()).length > 0; }
    async acquire(orgId: string, runId: string, owner: string, now: number, leaseMs: number): Promise<WorkflowRuntimeRun | null> {
        return this.db.transaction(async tx => { const run = await lockedRun(tx, orgId, runId); if (!run || !['IN_PROGRESS', 'PAUSED'].includes(run.status) || (run.leaseUntil !== undefined && run.leaseUntil >= now)) return null; const claimed = { ...run, leaseOwner: owner, leaseUntil: now + leaseMs }; await writeRun(tx, orgId, claimed); return claimed; });
    }
    async finish(orgId: string, runId: string, owner: string, record: WorkflowRuntimeRun): Promise<void> {
        await this.db.transaction(async tx => { const run = await lockedRun(tx, orgId, runId); if (run?.leaseOwner !== owner) workflowConflict(); await writeRun(tx, orgId, { ...record, orgId, runId, leaseUntil: 0, ttl: Math.floor(Date.now() / 1000) + (['PAUSED', 'WAITING_FOR_INPUT'].includes(record.status) ? 455 : 90) * 86400 }); });
    }
    async getStep(orgId: string, runId: string, nodeId: string): Promise<WorkflowRuntimeStep | null> { return (await this.db.select().from(steps).where(stepWhere(orgId, runId, nodeId)))[0]?.payload as unknown as WorkflowRuntimeStep ?? null; }
    async startStep(orgId: string, runId: string, nodeId: string, owner: string): Promise<boolean> {
        return this.db.transaction(async tx => { if ((await lockedRun(tx, orgId, runId))?.leaseOwner !== owner) return false; return (await tx.insert(steps).values(stepRow(orgId, runId, nodeId, { owner, startedAt: Date.now(), ttl: Math.floor(Date.now() / 1000) + 455 * 86400, status: 'STARTED' })).onConflictDoNothing().returning()).length > 0; });
    }
    async finishStep(orgId: string, runId: string, nodeId: string, owner: string, outcome: Record<string, unknown>): Promise<void> {
        await this.db.transaction(async tx => { if ((await lockedRun(tx, orgId, runId))?.leaseOwner !== owner) workflowConflict(); const changed = await tx.update(steps).set(stepRow(orgId, runId, nodeId, { owner, ttl: Math.floor(Date.now() / 1000) + 455 * 86400, status: outcome.status === 'failed' ? 'FAILED' : 'DONE', outcome })).where(stepWhere(orgId, runId, nodeId)).returning(); if (!changed.length) workflowConflict(); });
    }
    async wait(orgId: string, runId: string, nodeId: string, owner: string, wake: WorkflowWake): Promise<void> {
        if (wake.orgId !== orgId || wake.runId !== runId) throw new Error('Wake does not match the run scope'); const ttl = Math.floor(Date.parse(wake.dueAt) / 1000) + 90 * 86400; if (!Number.isFinite(ttl)) throw new Error('Invalid wake time');
        await this.db.transaction(async tx => { if ((await lockedRun(tx, orgId, runId))?.leaseOwner !== owner) workflowConflict(); const changed = await tx.update(steps).set(stepRow(orgId, runId, nodeId, { owner, status: 'WAITING', dueAt: wake.dueAt, ttl })).where(stepWhere(orgId, runId, nodeId)).returning(); if (!changed.length) workflowConflict(); await insertWake(tx, wake, true); });
    }
    async putWake(orgId: string, wake: WorkflowWake): Promise<boolean> { if (wake.orgId !== orgId) throw new Error('Wake does not match the organisation'); return insertWake(this.db, wake); }
    async getWake(orgId: string, wakeId: string): Promise<WorkflowWake | null> { return (await this.db.select().from(wakes).where(and(eq(wakes.orgId, workflowScope(orgId)), eq(wakes.wakeId, wakeId))))[0]?.payload as unknown as WorkflowWake ?? null; }
    async removeWake(wake: WorkflowWake): Promise<void> { await this.db.delete(wakes).where(and(eq(wakes.orgId, workflowScope(wake.orgId)), eq(wakes.wakeId, wake.wakeId))); }
    async listRunsPage(orgId: string, options: WorkflowPageOptions & { workflowId?: string; status?: string } = {}) {
        const scope = [workflowScope(orgId), 'runs', options.businessProfileId ?? null, options.workflowId ?? null, options.status ?? null]; const key = pageToken(options.nextToken, scope); const limit = pageLimit(options.limit);
        const rows = await this.db.select().from(runs).where(and(eq(runs.orgId, orgId), options.businessProfileId ? eq(runs.businessProfileId, options.businessProfileId) : undefined, options.workflowId ? eq(runs.workflowId, options.workflowId) : undefined, options.status ? eq(runs.status, options.status) : undefined, key ? or(lt(runs.startedAt, key[0]), and(eq(runs.startedAt, key[0]), lt(runs.runId, key[1]))) : undefined)).orderBy(desc(runs.startedAt), desc(runs.runId)).limit(limit + 1);
        const items = rows.slice(0, limit); const last = items.at(-1); return { items: items.map(r => r.payload as WorkflowRuntimeRun), ...(rows.length > limit && last ? { nextToken: nextPage(scope, [last.startedAt, last.runId]) } : {}) };
    }
    async listStepsPage(orgId: string, runId: string, options: WorkflowPageOptions & { nodeId?: string } = {}) {
        const scope = [workflowScope(orgId), 'steps', runId, options.nodeId ?? null]; const key = pageToken(options.nextToken, scope); const limit = pageLimit(options.limit);
        const rows = await this.db.select().from(steps).where(and(eq(steps.orgId, orgId), eq(steps.runId, runId), options.nodeId ? eq(steps.nodeId, options.nodeId) : undefined, key ? lt(steps.nodeId, key[0]) : undefined)).orderBy(desc(steps.nodeId)).limit(limit + 1);
        const items = rows.slice(0, limit); return { items: items.map(r => r.payload as unknown as WorkflowRuntimeStep), ...(rows.length > limit ? { nextToken: nextPage(scope, [items.at(-1)!.nodeId]) } : {}) };
    }
    async listExecutionLogsPage(orgId: string, runId: string, options: WorkflowPageOptions & { nodeId?: string } = {}) {
        const scope = [workflowScope(orgId), 'execution', runId, options.nodeId ?? null]; const key = pageToken(options.nextToken, scope); const limit = pageLimit(options.limit);
        const rows = await this.db.select().from(audit).where(and(eq(audit.orgId, orgId), eq(audit.runId, runId), eq(audit.kind, 'execution'), options.nodeId ? sql`${audit.payload}->>'nodeId' = ${options.nodeId}` : undefined, key ? lt(audit.recordId, key[0]) : undefined)).orderBy(desc(audit.recordId)).limit(limit + 1);
        const items = rows.slice(0, limit); return { items: items.map(r => r.payload), ...(rows.length > limit ? { nextToken: nextPage(scope, [items.at(-1)!.recordId]) } : {}) };
    }
    async resolveDeliveryReview(orgId: string, runId: string, review: WorkflowDeliveryReview, now = Date.now()): Promise<'resolved' | 'replayed' | 'conflict'> {
        workflowScope(orgId);
        if (!runId || !review.nodeId || !review.expectedOwner || !review.actorUserId || !/^[a-zA-Z0-9_-]{1,100}$/.test(review.reviewKey) || !Number.isFinite(review.expectedStartedAt) || !Number.isFinite(now) || !review.note.trim() || review.note.length > 2000 || !['retry', 'resume', 'stop'].includes(review.decision) || !['STARTED', 'DONE'].includes(review.expectedStatus ?? 'STARTED') || (review.decision === 'retry' && (review.confirmedNotDelivered !== true || review.expectedStatus === 'DONE')) || (review.decision === 'resume' && review.expectedStatus !== 'DONE')) throw new Error('Invalid workflow delivery review');
        const recordId = `WFREVIEW#${encodeURIComponent(runId)}#${review.reviewKey}`;
        const fingerprint = JSON.stringify([review.nodeId, review.expectedOwner, review.expectedStartedAt, review.decision, review.actorUserId, review.note.trim(), review.confirmedNotDelivered === true, review.expectedStatus ?? 'STARTED']);
        return this.db.transaction(async tx => {
            const run = await lockedRun(tx, orgId, runId); const replay = (await tx.select().from(audit).where(auditWhere(orgId, recordId)))[0]?.payload;
            if (replay) return replay.fingerprint === fingerprint ? 'replayed' : 'conflict';
            const step = (await tx.select().from(steps).where(stepWhere(orgId, runId, review.nodeId)))[0]?.payload;
            if (!run || run.status !== 'NEEDS_REVIEW' || typeof run.workflowVersion !== 'number' || Number(run.leaseUntil ?? 0) > now || (run.nodeStatuses as any)?.[review.nodeId] !== 'paused' || !step || step.status !== (review.expectedStatus ?? 'STARTED') || step.owner !== review.expectedOwner || (review.expectedStatus === 'DONE' ? !step.outcome : step.startedAt !== review.expectedStartedAt)) return 'conflict';
            const reviewedAt = new Date(now).toISOString(); const lastDeliveryReview = { nodeId: review.nodeId, decision: review.decision, actorUserId: review.actorUserId, note: review.note.trim(), reviewedAt, reviewKey: review.reviewKey }; const ttl = Math.floor(now / 1000) + 455 * 86400;
            const updated: WorkflowRuntimeRun = { ...run, status: review.decision === 'stop' ? 'FAILED' : 'PAUSED', leaseUntil: 0, lastDeliveryReview, ttl };
            delete updated.leaseOwner; delete updated.reviewNodeId; delete updated.error; delete updated.completedAt;
            if (review.decision === 'stop') { updated.completedAt = reviewedAt; updated.error = 'Stopped after delivery review'; }
            await writeRun(tx, orgId, updated);
            if (review.decision === 'retry') await tx.delete(steps).where(stepWhere(orgId, runId, review.nodeId));
            await tx.insert(audit).values({ orgId, recordId, runId, kind: 'review', payload: clean({ orgId, sk: recordId, runId, ...lastDeliveryReview, fingerprint, ttl }) });
            if (review.decision !== 'stop') await insertWake(tx, { orgId, runId, workflowId: run.workflowId, workflowVersion: run.workflowVersion, wakeId: `review-${encodeURIComponent(runId)}-${review.reviewKey}`, dueAt: reviewedAt, kind: 'wait' });
            return 'resolved';
        });
    }
    async submitInputs(orgId: string, runId: string, submission: WorkflowInputSubmission, now = Date.now()): Promise<'resolved' | 'replayed' | 'conflict'> {
        workflowScope(orgId); if (!runId || !Number.isFinite(now)) throw new Error('Invalid workflow input submission'); const fingerprint = inputSubmissionFingerprint(submission); const recordId = `WFINPUT#${encodeURIComponent(runId)}#${submission.submissionKey}`;
        return this.db.transaction(async tx => {
            const run = await lockedRun(tx, orgId, runId); const replay = (await tx.select().from(audit).where(auditWhere(orgId, recordId)))[0]?.payload;
            if (replay) return replay.fingerprint === fingerprint ? 'replayed' : 'conflict';
            if (!run || run.status !== 'WAITING_FOR_INPUT' || !run.inputRequest || run.inputRequest.requestId !== submission.requestId || typeof run.workflowVersion !== 'number' || Number(run.leaseUntil ?? 0) > now) return 'conflict';
            if ((await tx.select().from(steps).where(stepWhere(orgId, runId, run.inputRequest.nodeId))).length) return 'conflict';
            const input = mergeWorkflowAnswers(run.input, run.inputRequest, submission.answers); const submittedAt = new Date(now).toISOString(); const record = { requestId: submission.requestId, submissionKey: submission.submissionKey, actorUserId: submission.actorUserId, nodeId: run.inputRequest.nodeId, fields: run.inputRequest.fields.map(field => field.path), submittedAt }; const ttl = Math.floor(now / 1000) + 455 * 86400;
            const updated: WorkflowRuntimeRun = { ...run, input, status: 'PAUSED', leaseUntil: 0, lastInputSubmission: record, ttl }; delete updated.inputRequest; delete updated.leaseOwner; delete updated.error; delete updated.completedAt;
            await writeRun(tx, orgId, updated); await tx.insert(audit).values({ orgId, recordId, runId, kind: 'input', payload: clean({ orgId, sk: recordId, runId, ...record, fingerprint, ttl }) });
            await insertWake(tx, { orgId, runId, workflowId: run.workflowId, workflowVersion: run.workflowVersion, wakeId: `input-${encodeURIComponent(runId)}-${submission.submissionKey}`, dueAt: submittedAt, kind: 'wait' }); return 'resolved';
        });
    }
}
export class WorkflowDuePgRepo implements IWorkflowDueRepo {
    constructor(private readonly injected?: PgDb) {}
    private get db() { return this.injected ?? getPgTx(); }
    async listDue(now: string, nextToken?: string, requestedLimit = 20) {
        const through = new Date(now).toISOString(); const scope = ['workflow-due']; const key = pageToken(nextToken, scope); const limit = pageLimit(requestedLimit);
        const rows = await this.db.select({ orgId: wakes.orgId, wakeId: wakes.wakeId, dueAt: wakes.dueAt }).from(wakes).where(and(lte(wakes.dueAt, through), key ? sql`(${wakes.dueAt}, ${wakes.orgId}, ${wakes.wakeId}) > (${key[0]}, ${key[1]}, ${key[2]})` : undefined)).orderBy(asc(wakes.dueAt), asc(wakes.orgId), asc(wakes.wakeId)).limit(limit + 1);
        const items = rows.slice(0, limit); const last = items.at(-1); return { items: items.map(r => ({ tenantOrgId: r.orgId, wakeId: r.wakeId, dueAt: r.dueAt })), ...(rows.length > limit && last ? { nextToken: nextPage(scope, [last.dueAt, last.orgId, last.wakeId]) } : {}) };
    }
}
