import { inputSubmissionFingerprint, mergeWorkflowAnswers, type WorkflowInputRequest, type WorkflowInputSubmission } from './input';
import { workflowPage, type WorkflowPageOptions } from './page';
import type { IDdb } from '../ddbPort';
import { Tables } from '../tables';

export interface WorkflowRuntimeRun extends Record<string, unknown> {
    orgId: string; runId: string; workflowId: string;
    status: 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'NEEDS_REVIEW' | 'WAITING_FOR_INPUT';
    inputRequest?: WorkflowInputRequest;
    leaseOwner?: string; leaseUntil?: number;
}
export interface WorkflowRuntimeStep {
    orgId: string; runId: string; nodeId: string; owner: string;
    status: 'STARTED' | 'DONE' | 'FAILED' | 'WAITING';
    outcome?: Record<string, unknown>; dueAt?: string; startedAt?: number;
}
export interface WorkflowDeliveryReview {
    reviewKey: string; nodeId: string; expectedOwner: string; expectedStartedAt: number;
    decision: 'retry' | 'resume' | 'stop'; expectedStatus?: 'STARTED' | 'DONE'; actorUserId: string; note: string; confirmedNotDelivered?: boolean;
}
export interface WorkflowWake {
    orgId: string; wakeId: string; runId: string; workflowId: string; dueAt: string;
    kind?: 'wait' | 'schedule'; workflowVersion?: number;
}
export interface WorkflowDueLocator { tenantOrgId: string; wakeId: string; dueAt: string }

function scope(orgId: string) {
    if (!orgId || orgId.startsWith('__') || !/^[a-zA-Z0-9_-]+$/.test(orgId)) throw new Error('Invalid workflow organisation');
    return orgId;
}
const runKey = (orgId: string, runId: string) => ({ orgId: scope(orgId), sk: `WFRUN#${runId}` });
const stepKey = (orgId: string, runId: string, nodeId: string) => ({ orgId: scope(orgId), sk: `WFSTEP#${encodeURIComponent(runId)}#${encodeURIComponent(nodeId)}` });
const wakeKey = (orgId: string, wakeId: string) => ({ orgId: scope(orgId), sk: `WFWAKE#${wakeId}` });
const dueKey = (wake: WorkflowWake) => ({ dueBucket: 'workflow', dueSort: `${new Date(wake.dueAt).toISOString()}#${scope(wake.orgId)}#${wake.wakeId}` });
function conflict(error: unknown) {
    const e = error as { name?: string; CancellationReasons?: Array<{ Code?: string }> };
    return e.name === 'ConditionalCheckFailedException' || (e.name === 'TransactionCanceledException' && e.CancellationReasons?.some(reason => reason.Code === 'ConditionalCheckFailed'));
}

/** Tenant data operations. Every write is conditional on creation or the active lease. */
export class WorkflowRuntimeDynamoRepo {
    constructor(private readonly db: IDdb) {}

    listRunsPage(orgId: string, options: WorkflowPageOptions & { workflowId?: string; status?: string } = {}) {
        return workflowPage<WorkflowRuntimeRun>(this.db, scope(orgId), 'WFRUN#', options, { workflowId: options.workflowId, status: options.status });
    }

    listExecutionLogsPage(orgId: string, runId: string, options: WorkflowPageOptions & { nodeId?: string } = {}) {
        return workflowPage<Record<string, unknown>>(this.db, scope(orgId), `EXECLOG#${runId}#`, options, { runId, nodeId: options.nodeId });
    }

    listStepsPage(orgId: string, runId: string, options: WorkflowPageOptions & { nodeId?: string } = {}) {
        return workflowPage<WorkflowRuntimeStep>(this.db, scope(orgId), `WFSTEP#${encodeURIComponent(runId)}#`, options, { runId, nodeId: options.nodeId });
    }

    async get(orgId: string, runId: string): Promise<WorkflowRuntimeRun | null> {
        const { Item } = await this.db.getItem(Tables.ONBOARDING, runKey(orgId, runId), { ConsistentRead: true });
        return Item as WorkflowRuntimeRun ?? null;
    }
    async create(orgId: string, run: Omit<WorkflowRuntimeRun, 'orgId'> & { runId: string }): Promise<boolean> {
        try {
            await this.db.transactWrite([{ Put: { TableName: Tables.ONBOARDING, Item: { ...run, ttl: run.ttl ?? Math.floor(Date.now() / 1000) + 455 * 86400, ...runKey(orgId, run.runId) }, ConditionExpression: 'attribute_not_exists(sk)' } }]);
            return true;
        } catch (error) { if (conflict(error)) return false; throw error; }
    }
    async acquire(orgId: string, runId: string, owner: string, now: number, leaseMs: number): Promise<WorkflowRuntimeRun | null> {
        try {
            const { Attributes } = await this.db.update(Tables.ONBOARDING, runKey(orgId, runId), {
                UpdateExpression: 'SET leaseOwner = :owner, leaseUntil = :until',
                ConditionExpression: 'attribute_exists(sk) AND (#status = :running OR #status = :paused) AND (attribute_not_exists(leaseUntil) OR leaseUntil < :now)',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':owner': owner, ':until': now + leaseMs, ':now': now, ':running': 'IN_PROGRESS', ':paused': 'PAUSED' }, ReturnValues: 'ALL_NEW',
            });
            return Attributes as WorkflowRuntimeRun;
        } catch (error) { if (conflict(error)) return null; throw error; }
    }
    async finish(orgId: string, runId: string, owner: string, record: WorkflowRuntimeRun): Promise<void> {
        await this.db.transactWrite([{ Put: {
            TableName: Tables.ONBOARDING,
            Item: { ...record, runId, leaseUntil: 0, ttl: Math.floor(Date.now() / 1000) + (['PAUSED', 'WAITING_FOR_INPUT'].includes(record.status) ? 455 : 90) * 86400, ...runKey(orgId, runId) },
            ConditionExpression: 'leaseOwner = :owner', ExpressionAttributeValues: { ':owner': owner },
        } }]);
    }
    /** An explicit operator decision releases only the reviewed attempt, atomically with its wake. */
    async resolveDeliveryReview(orgId: string, runId: string, review: WorkflowDeliveryReview, now = Date.now()): Promise<'resolved' | 'replayed' | 'conflict'> {
        scope(orgId);
        if (!runId || !review.nodeId || !review.expectedOwner || !review.actorUserId || !/^[a-zA-Z0-9_-]{1,100}$/.test(review.reviewKey) ||
            !Number.isFinite(review.expectedStartedAt) || !Number.isFinite(now) || !review.note.trim() || review.note.length > 2000 ||
            !['retry', 'resume', 'stop'].includes(review.decision) || !['STARTED', 'DONE'].includes(review.expectedStatus ?? 'STARTED') || (review.decision === 'retry' && (review.confirmedNotDelivered !== true || review.expectedStatus === 'DONE')) || (review.decision === 'resume' && review.expectedStatus !== 'DONE')) throw new Error('Invalid workflow delivery review');
        const key = { orgId, sk: `WFREVIEW#${encodeURIComponent(runId)}#${review.reviewKey}` };
        const fingerprint = JSON.stringify([review.nodeId, review.expectedOwner, review.expectedStartedAt, review.decision, review.actorUserId, review.note.trim(), review.confirmedNotDelivered === true, review.expectedStatus ?? 'STARTED']);
        const replay = async () => {
            const { Item } = await this.db.getItem(Tables.ONBOARDING, key, { ConsistentRead: true });
            return Item ? (Item.fingerprint === fingerprint ? 'replayed' : 'conflict') as 'replayed' | 'conflict' : null;
        };
        const existing = await replay();
        if (existing) return existing;
        const run = await this.get(orgId, runId);
        if (!run || run.status !== 'NEEDS_REVIEW' || typeof run.workflowVersion !== 'number') return 'conflict';
        const reviewedAt = new Date(now).toISOString();
        const lastDeliveryReview = { nodeId: review.nodeId, decision: review.decision, actorUserId: review.actorUserId, note: review.note.trim(), reviewedAt, reviewKey: review.reviewKey };
        const ttl = Math.floor(now / 1000) + 455 * 86400;
        const stepCondition = {
            TableName: Tables.ONBOARDING, Key: stepKey(orgId, runId, review.nodeId),
            ConditionExpression: review.expectedStatus === 'DONE' ? '#status = :started AND #owner = :owner AND attribute_exists(outcome)' : '#status = :started AND #owner = :owner AND startedAt = :startedAt',
            ExpressionAttributeNames: { '#status': 'status', '#owner': 'owner' },
            ExpressionAttributeValues: { ':started': review.expectedStatus ?? 'STARTED', ':owner': review.expectedOwner, ...(review.expectedStatus === 'DONE' ? {} : { ':startedAt': review.expectedStartedAt }) },
        };
        const operations: Parameters<IDdb['transactWrite']>[0] = [
            { Update: {
                TableName: Tables.ONBOARDING, Key: runKey(orgId, runId),
                UpdateExpression: review.decision !== 'stop'
                    ? 'SET #status = :status, leaseUntil = :zero, lastDeliveryReview = :review, #ttl = :ttl REMOVE #error, completedAt, reviewNodeId, leaseOwner'
                    : 'SET #status = :status, leaseUntil = :zero, lastDeliveryReview = :review, #ttl = :ttl, completedAt = :at, #error = :error REMOVE reviewNodeId, leaseOwner',
                ConditionExpression: '#status = :needsReview AND (attribute_not_exists(leaseUntil) OR leaseUntil <= :now) AND workflowVersion = :version AND #nodes.#node = :paused',
                ExpressionAttributeNames: { '#status': 'status', '#error': 'error', '#nodes': 'nodeStatuses', '#node': review.nodeId, '#ttl': 'ttl' },
                ExpressionAttributeValues: { ':status': review.decision !== 'stop' ? 'PAUSED' : 'FAILED', ':zero': 0, ':review': lastDeliveryReview, ':ttl': ttl,
                    ':needsReview': 'NEEDS_REVIEW', ':now': now, ':version': run.workflowVersion, ':paused': 'paused',
                    ...(review.decision === 'stop' ? { ':at': reviewedAt, ':error': 'Stopped after delivery review' } : {}) },
            } },
            review.decision === 'retry' ? { Delete: stepCondition } : { ConditionCheck: stepCondition },
            { Put: { TableName: Tables.ONBOARDING, Item: { ...key, runId, ...lastDeliveryReview, fingerprint, ttl }, ConditionExpression: 'attribute_not_exists(sk)' } },
        ];
        if (review.decision !== 'stop') {
            const wake: WorkflowWake = { orgId, runId, workflowId: run.workflowId, workflowVersion: run.workflowVersion as number,
                wakeId: `review-${encodeURIComponent(runId)}-${review.reviewKey}`, dueAt: reviewedAt, kind: 'wait' };
            operations.push({ Put: { TableName: Tables.ONBOARDING, Item: { ...wake, ...wakeKey(orgId, wake.wakeId), ...dueKey(wake), ttl }, ConditionExpression: 'attribute_not_exists(sk)' } });
        }
        try { await this.db.transactWrite(operations); return 'resolved'; }
        catch (error) { if (conflict(error)) return (await replay()) ?? 'conflict'; throw error; }
    }

    async submitInputs(orgId: string, runId: string, submission: WorkflowInputSubmission, now = Date.now()): Promise<'resolved' | 'replayed' | 'conflict'> {
        scope(orgId);
        if (!runId || !Number.isFinite(now)) throw new Error('Invalid workflow input submission');
        const fingerprint = inputSubmissionFingerprint(submission);
        const key = { orgId, sk: `WFINPUT#${encodeURIComponent(runId)}#${submission.submissionKey}` };
        const replay = async () => {
            const { Item } = await this.db.getItem(Tables.ONBOARDING, key, { ConsistentRead: true });
            return Item ? (Item.fingerprint === fingerprint ? 'replayed' : 'conflict') as 'replayed' | 'conflict' : null;
        };
        const existing = await replay();
        if (existing) return existing;
        const run = await this.get(orgId, runId);
        if (!run || run.status !== 'WAITING_FOR_INPUT' || !run.inputRequest || run.inputRequest.requestId !== submission.requestId || typeof run.workflowVersion !== 'number') return 'conflict';
        const input = mergeWorkflowAnswers(run.input, run.inputRequest, submission.answers);
        const submittedAt = new Date(now).toISOString();
        const record = { requestId: submission.requestId, submissionKey: submission.submissionKey, actorUserId: submission.actorUserId, nodeId: run.inputRequest.nodeId, fields: run.inputRequest.fields.map(field => field.path), submittedAt };
        const ttl = Math.floor(now / 1000) + 455 * 86400;
        const wake: WorkflowWake = { orgId, runId, workflowId: run.workflowId, workflowVersion: run.workflowVersion as number,
            wakeId: `input-${encodeURIComponent(runId)}-${submission.submissionKey}`, dueAt: submittedAt, kind: 'wait' };
        try {
            await this.db.transactWrite([
                { Update: { TableName: Tables.ONBOARDING, Key: runKey(orgId, runId),
                    UpdateExpression: 'SET #status = :paused, #input = :input, leaseUntil = :zero, lastInputSubmission = :record, #ttl = :ttl REMOVE inputRequest, leaseOwner, #error, completedAt',
                    ConditionExpression: '#status = :waiting AND inputRequest.requestId = :requestId AND inputRequest.nodeId = :node AND workflowVersion = :version AND (attribute_not_exists(leaseUntil) OR leaseUntil <= :now)',
                    ExpressionAttributeNames: { '#status': 'status', '#input': 'input', '#ttl': 'ttl', '#error': 'error' },
                    ExpressionAttributeValues: { ':paused': 'PAUSED', ':waiting': 'WAITING_FOR_INPUT', ':input': input, ':zero': 0, ':record': record, ':ttl': ttl, ':requestId': submission.requestId, ':node': run.inputRequest.nodeId, ':version': run.workflowVersion, ':now': now },
                } },
                { ConditionCheck: { TableName: Tables.ONBOARDING, Key: stepKey(orgId, runId, run.inputRequest.nodeId), ConditionExpression: 'attribute_not_exists(sk)' } },
                { Put: { TableName: Tables.ONBOARDING, Item: { ...key, runId, ...record, fingerprint, ttl }, ConditionExpression: 'attribute_not_exists(sk)' } },
                { Put: { TableName: Tables.ONBOARDING, Item: { ...wake, ...wakeKey(orgId, wake.wakeId), ...dueKey(wake), ttl }, ConditionExpression: 'attribute_not_exists(sk)' } },
            ]);
            return 'resolved';
        } catch (error) { if (conflict(error)) return (await replay()) ?? 'conflict'; throw error; }
    }

    async getStep(orgId: string, runId: string, nodeId: string): Promise<WorkflowRuntimeStep | null> {
        const { Item } = await this.db.getItem(Tables.ONBOARDING, stepKey(orgId, runId, nodeId), { ConsistentRead: true });
        return Item as WorkflowRuntimeStep ?? null;
    }
    async startStep(orgId: string, runId: string, nodeId: string, owner: string): Promise<boolean> {
        try {
            await this.db.transactWrite([
                { ConditionCheck: { TableName: Tables.ONBOARDING, Key: runKey(orgId, runId), ConditionExpression: 'leaseOwner = :owner', ExpressionAttributeValues: { ':owner': owner } } },
                { Put: { TableName: Tables.ONBOARDING, Item: { ...stepKey(orgId, runId, nodeId), runId, nodeId, owner, startedAt: Date.now(), ttl: Math.floor(Date.now() / 1000) + 455 * 86400, status: 'STARTED' }, ConditionExpression: 'attribute_not_exists(sk)' } },
            ]);
            return true;
        } catch (error) { if (conflict(error)) return false; throw error; }
    }
    async finishStep(orgId: string, runId: string, nodeId: string, owner: string, outcome: Record<string, unknown>): Promise<void> {
        await this.db.transactWrite([
            { ConditionCheck: { TableName: Tables.ONBOARDING, Key: runKey(orgId, runId), ConditionExpression: 'leaseOwner = :owner', ExpressionAttributeValues: { ':owner': owner } } },
            { Put: { TableName: Tables.ONBOARDING, Item: { ...stepKey(orgId, runId, nodeId), runId, nodeId, owner, ttl: Math.floor(Date.now() / 1000) + 455 * 86400, status: outcome.status === 'failed' ? 'FAILED' : 'DONE', outcome }, ConditionExpression: 'attribute_exists(sk)' } },
        ]);
    }
    async wait(orgId: string, runId: string, nodeId: string, owner: string, wake: WorkflowWake): Promise<void> {
        if (wake.orgId !== orgId || wake.runId !== runId) throw new Error('Wake does not match the run scope');
        const ttl = Math.floor(Date.parse(wake.dueAt) / 1000) + 90 * 86400;
        if (!Number.isFinite(ttl)) throw new Error('Invalid wake time');
        await this.db.transactWrite([
            { ConditionCheck: { TableName: Tables.ONBOARDING, Key: runKey(orgId, runId), ConditionExpression: 'leaseOwner = :owner', ExpressionAttributeValues: { ':owner': owner } } },
            { Put: { TableName: Tables.ONBOARDING, Item: { ...stepKey(orgId, runId, nodeId), runId, nodeId, owner, status: 'WAITING', dueAt: wake.dueAt, ttl }, ConditionExpression: 'attribute_exists(sk)' } },
            { Put: { TableName: Tables.ONBOARDING, Item: { ...wake, ...wakeKey(orgId, wake.wakeId), ...dueKey(wake), ttl } } },
        ]);
    }
    async putWake(orgId: string, wake: WorkflowWake): Promise<boolean> {
        if (wake.orgId !== orgId) throw new Error('Wake does not match the organisation');
        const ttl = Math.floor(Date.parse(wake.dueAt) / 1000) + 90 * 86400;
        if (!Number.isFinite(ttl)) throw new Error('Invalid wake time');
        try {
            await this.db.transactWrite([{ Put: { TableName: Tables.ONBOARDING, Item: { ...wake, ...wakeKey(orgId, wake.wakeId), ...dueKey(wake), ttl }, ConditionExpression: 'attribute_not_exists(sk)' } }]);
            return true;
        } catch (error) { if (conflict(error)) return false; throw error; }
    }
    async getWake(orgId: string, wakeId: string): Promise<WorkflowWake | null> {
        const { Item } = await this.db.getItem(Tables.ONBOARDING, wakeKey(orgId, wakeId), { ConsistentRead: true });
        return Item as WorkflowWake ?? null;
    }
    async removeWake(wake: WorkflowWake): Promise<void> {
        await this.db.transactWrite([
            { Delete: { TableName: Tables.ONBOARDING, Key: wakeKey(wake.orgId, wake.wakeId) } },
        ]);
    }
}

/** Privileged scheduling metadata only. Do not expose this repo to tenant requests. */
export class WorkflowDueDynamoRepo {
    constructor(private readonly db: IDdb) {}
    async listDue(now: string, nextToken?: string, limit = 20): Promise<{ items: WorkflowDueLocator[]; nextToken?: string }> {
        const dueThrough = `${new Date(now).toISOString()}#~`;
        const exclusive = nextToken ? JSON.parse(Buffer.from(nextToken, 'base64').toString('utf8')) : undefined;
        if (exclusive && (exclusive.dueBucket !== 'workflow' || typeof exclusive.dueSort !== 'string')) throw new Error('Invalid nextToken');
        const result = await this.db.query({
            TableName: Tables.ONBOARDING, IndexName: 'workflow-due-index',
            KeyConditionExpression: 'dueBucket = :bucket AND dueSort <= :through',
            ExpressionAttributeValues: { ':bucket': 'workflow', ':through': dueThrough },
            ExclusiveStartKey: exclusive, Limit: Math.max(1, Math.min(100, limit)),
        });
        return {
            items: (result.Items ?? []).map(item => ({ tenantOrgId: String(item.orgId), wakeId: String(item.wakeId), dueAt: String(item.dueAt) })),
            ...(result.LastEvaluatedKey ? { nextToken: Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64') } : {}),
        };
    }
}

export interface IWorkflowRuntimeRepo extends Pick<WorkflowRuntimeDynamoRepo, keyof WorkflowRuntimeDynamoRepo> {}
export interface IWorkflowDueRepo extends Pick<WorkflowDueDynamoRepo, keyof WorkflowDueDynamoRepo> {}
export { WorkflowRuntimeRepo, WorkflowDueRepo } from './factory';
