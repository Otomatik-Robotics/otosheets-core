import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { onboardingRunSk, workflowRunSk, workflowApprovalSk } from '../keys';
import { WorkflowRun, WorkflowApproval } from './schema';

export class WorkflowRunRepo {
    constructor(private ddb: IDdb) {}

    async get(orgId: string, membershipId: string): Promise<WorkflowRun | null> {
        const { Item } = await this.ddb.getItem(Tables.ONBOARDING, {
            orgId,
            sk: onboardingRunSk(membershipId),
        });
        return (Item as WorkflowRun) ?? null;
    }

    async list(orgId: string): Promise<WorkflowRun[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'ONBOARDING#' },
        });
        return (Items as WorkflowRun[]) ?? [];
    }

    async put(orgId: string, run: Omit<WorkflowRun, 'orgId' | 'sk'>): Promise<void> {
        const sk = run.membershipId
            ? onboardingRunSk(run.membershipId)
            : workflowRunSk(run.runId!);
        await this.ddb.put(Tables.ONBOARDING, { orgId, sk, ...run });
    }

    async listRuns(orgId: string): Promise<WorkflowRun[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'RUN#' },
        });
        return (Items as WorkflowRun[]) ?? [];
    }

    async getRun(orgId: string, runId: string): Promise<WorkflowRun | null> {
        const { Item } = await this.ddb.getItem(Tables.ONBOARDING, {
            orgId,
            sk: workflowRunSk(runId),
        });
        return (Item as WorkflowRun) ?? null;
    }

    async listRunsByWorkflow(orgId: string, workflowId: string, limit: number): Promise<WorkflowRun[]> {
        const all = await this.listRuns(orgId);
        return all
            .filter(r => r.workflowId === workflowId)
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
            .slice(0, limit);
    }

    async listRunsByOrg(orgId: string, limit: number): Promise<WorkflowRun[]> {
        const all = await this.listRuns(orgId);
        return all
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
            .slice(0, limit);
    }

    async update(orgId: string, membershipId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = [];
        const names: Record<string, string> = {};
        const values: Record<string, any> = {};

        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }

        await this.ddb.update(Tables.ONBOARDING, { orgId, sk: onboardingRunSk(membershipId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
}

// Backward-compat alias (deprecated — use WorkflowRunRepo)
/** @deprecated Use WorkflowRunRepo */
export { WorkflowRunRepo as OnboardingRunRepo };

function approvalConflict(error: unknown): boolean {
    const failure = error as { name?: string; CancellationReasons?: Array<{ Code?: string }> };
    return failure.name === 'ConditionalCheckFailedException' || (failure.name === 'TransactionCanceledException' && failure.CancellationReasons?.some(reason => reason.Code === 'ConditionalCheckFailed') === true);
}

export class WorkflowApprovalDynamoRepo {
    constructor(private ddb: IDdb) {}

    async create(approval: Omit<WorkflowApproval, 'sk'>): Promise<boolean> {
        try {
            await this.ddb.transactWrite([{ Put: { TableName: Tables.ONBOARDING, Item: { ...approval, sk: workflowApprovalSk(approval.approvalId) }, ConditionExpression: 'attribute_not_exists(sk)' } }]);
            return true;
        } catch (error) { if (approvalConflict(error)) return false; throw error; }
    }

    async decide(orgId: string, approvalId: string, membershipId: string, decidedBy: string, decision: 'approved' | 'rejected', now: string, comment?: string): Promise<boolean> {
        try {
            await this.ddb.transactWrite([{ Update: { TableName: Tables.ONBOARDING, Key: { orgId, sk: workflowApprovalSk(approvalId) },
                UpdateExpression: 'SET #status = :decision, decision = :decision, decidedAt = :now, decidedBy = :user, #comment = :comment',
                ConditionExpression: '#status = :pending AND contains(assignedTo, :member) AND (attribute_not_exists(expiresAt) OR expiresAt > :now)',
                ExpressionAttributeNames: { '#status': 'status', '#comment': 'comment' },
                ExpressionAttributeValues: { ':decision': decision, ':now': now, ':user': decidedBy, ':comment': comment ?? '', ':pending': 'pending', ':member': membershipId },
            } }]);
            return true;
        } catch (error) { if (approvalConflict(error)) return false; throw error; }
    }

    async expire(orgId: string, approvalId: string, now: string): Promise<boolean> {
        try {
            await this.ddb.transactWrite([{ Update: { TableName: Tables.ONBOARDING, Key: { orgId, sk: workflowApprovalSk(approvalId) },
                UpdateExpression: 'SET #status = :expired, decidedAt = :now',
                ConditionExpression: '#status = :pending AND expiresAt <= :now',
                ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':expired': 'expired', ':pending': 'pending', ':now': now },
            } }]);
            return true;
        } catch (error) { if (approvalConflict(error)) return false; throw error; }
    }

    async listPendingPage(orgId: string, membershipId: string, nextToken?: string, limit = 20): Promise<{ approvals: WorkflowApproval[]; nextToken?: string }> {
        const key = nextToken ? JSON.parse(Buffer.from(nextToken, 'base64').toString('utf8')) : undefined;
        if (key && (key.orgId !== orgId || typeof key.sk !== 'string' || !key.sk.startsWith('APPROVAL#'))) throw new Error('Invalid nextToken');
        const page = await this.ddb.query({ TableName: Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            FilterExpression: '#status = :pending AND contains(assignedTo, :member) AND (attribute_not_exists(expiresAt) OR expiresAt > :now)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'APPROVAL#', ':pending': 'pending', ':member': membershipId, ':now': new Date().toISOString() },
            Limit: Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 20)), ExclusiveStartKey: key,
        });
        return { approvals: (page.Items ?? []) as WorkflowApproval[], ...(page.LastEvaluatedKey ? { nextToken: Buffer.from(JSON.stringify(page.LastEvaluatedKey)).toString('base64') } : {}) };
    }

    async put(approval: Omit<WorkflowApproval, 'sk'>): Promise<void> {
        await this.ddb.put(Tables.ONBOARDING, {
            ...approval,
            sk: workflowApprovalSk(approval.approvalId),
        });
    }

    async get(orgId: string, approvalId: string): Promise<WorkflowApproval | null> {
        const { Item } = await this.ddb.getItem(Tables.ONBOARDING, {
            orgId,
            sk: workflowApprovalSk(approvalId),
        }, { ConsistentRead: true });
        return (Item as WorkflowApproval) ?? null;
    }

    async listPending(orgId: string): Promise<WorkflowApproval[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'APPROVAL#' },
        });
        const all = (Items as WorkflowApproval[]) ?? [];
        return all.filter(a => a.status === 'pending');
    }

    async resolve(orgId: string, approvalId: string, status: 'approved' | 'rejected', resolvedBy: string, comment?: string): Promise<void> {
        const sets = ['#status = :status', '#resolvedAt = :resolvedAt', '#resolvedBy = :resolvedBy'];
        const names: Record<string, string> = { '#status': 'status', '#resolvedAt': 'resolvedAt', '#resolvedBy': 'resolvedBy' };
        const values: Record<string, any> = { ':status': status, ':resolvedAt': new Date().toISOString(), ':resolvedBy': resolvedBy };

        if (comment) {
            sets.push('#comment = :comment');
            names['#comment'] = 'comment';
            values[':comment'] = comment;
        }

        await this.ddb.update(Tables.ONBOARDING, { orgId, sk: workflowApprovalSk(approvalId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
}

export interface IWorkflowApprovalRepo extends Pick<WorkflowApprovalDynamoRepo, keyof WorkflowApprovalDynamoRepo> {}
export { WorkflowApprovalRepo } from './approval.factory';
