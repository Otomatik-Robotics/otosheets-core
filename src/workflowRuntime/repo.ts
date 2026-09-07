import type { IDdb } from '../ddbPort';
import { Tables } from '../tables';

export interface WorkflowRuntimeRun extends Record<string, unknown> {
    orgId: string; runId: string; workflowId: string;
    status: 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'NEEDS_REVIEW';
    leaseOwner?: string; leaseUntil?: number;
}
export interface WorkflowRuntimeStep {
    orgId: string; runId: string; nodeId: string; owner: string;
    status: 'STARTED' | 'DONE' | 'FAILED' | 'WAITING';
    outcome?: Record<string, unknown>; dueAt?: string; startedAt?: number;
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
export class WorkflowRuntimeRepo {
    constructor(private readonly db: IDdb) {}

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
            Item: { ...record, runId, leaseUntil: 0, ttl: Math.floor(Date.now() / 1000) + (record.status === 'PAUSED' ? 455 : 90) * 86400, ...runKey(orgId, runId) },
            ConditionExpression: 'leaseOwner = :owner', ExpressionAttributeValues: { ':owner': owner },
        } }]);
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
export class WorkflowDueRepo {
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
