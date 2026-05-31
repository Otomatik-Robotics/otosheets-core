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

export class WorkflowApprovalRepo {
    constructor(private ddb: IDdb) {}

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
        });
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
