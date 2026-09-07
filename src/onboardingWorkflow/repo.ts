import { workflowPage, type WorkflowPageOptions } from '../workflowRuntime/page';
import { createHash } from 'crypto';
import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { onboardingWorkflowSk } from '../keys';
import { OnboardingWorkflow } from './schema';

export interface WorkflowDefinitionVersion {
    orgId: string;
    workflowId: string;
    version: number;
    nodes: OnboardingWorkflow['nodes'];
    edges: OnboardingWorkflow['edges'];
    createdAt: string;
    createdBy: string;
    saveKey?: string;
    fingerprint?: string;
}

function versionConflict(error: unknown): boolean {
    const failure = error as { name?: string; CancellationReasons?: Array<{ Code?: string }> };
    return failure.name === 'ConditionalCheckFailedException' || (failure.name === 'TransactionCanceledException' && failure.CancellationReasons?.some(reason => reason.Code === 'ConditionalCheckFailed') === true);
}

export class OnboardingWorkflowDynamoRepo {
    constructor(private ddb: IDdb) {}

    async get(orgId: string, workflowId: string): Promise<OnboardingWorkflow | null> {
        const { Item } = await this.ddb.getItem(Tables.ONBOARDING, {
            orgId,
            sk: onboardingWorkflowSk(workflowId),
        }, { ConsistentRead: true });
        return (Item as OnboardingWorkflow) ?? null;
    }

    async getVersion(orgId: string, workflowId: string, version: number): Promise<WorkflowDefinitionVersion | null> {
        const { Item } = await this.ddb.getItem(Tables.ONBOARDING, { orgId, sk: `VERSION#${workflowId}#${String(version).padStart(6, '0')}` }, { ConsistentRead: true });
        return Item as WorkflowDefinitionVersion ?? null;
    }

    /** Persist draft and immutable version together; stale revisions never overwrite either record. */
    async saveVersion(orgId: string, workflow: Omit<OnboardingWorkflow, 'orgId' | 'sk'>, expectedVersion: number, saveKey: string): Promise<{ status: 'saved' | 'replayed' | 'conflict'; version: number }> {
        if (!Number.isInteger(expectedVersion) || expectedVersion < 0 || expectedVersion >= 999999 || !saveKey.trim() || saveKey.length > 200) throw new Error('Invalid workflow save identity');
        const version = expectedVersion + 1;
        const fingerprint = createHash('sha256').update(JSON.stringify({ name: workflow.name, description: workflow.description, isActive: workflow.isActive, nodes: workflow.nodes, edges: workflow.edges })).digest('hex');
        const versionRecord: WorkflowDefinitionVersion = { orgId, workflowId: workflow.workflowId, version, nodes: workflow.nodes, edges: workflow.edges, createdAt: workflow.updatedAt, createdBy: workflow.updatedBy ?? workflow.createdBy ?? '', saveKey, fingerprint };
        try {
            await this.ddb.transactWrite([
                { Put: { TableName: Tables.ONBOARDING, Item: { ...workflow, orgId, sk: onboardingWorkflowSk(workflow.workflowId), currentVersion: version },
                    ConditionExpression: `${expectedVersion === 0 ? 'attribute_not_exists(currentVersion)' : 'currentVersion = :expected'} AND ${workflow.activeVersion === undefined ? 'attribute_not_exists(activeVersion)' : 'activeVersion = :published'}`,
                    ...((expectedVersion !== 0 || workflow.activeVersion !== undefined) ? { ExpressionAttributeValues: { ...(expectedVersion === 0 ? {} : { ':expected': expectedVersion }), ...(workflow.activeVersion === undefined ? {} : { ':published': workflow.activeVersion }) } } : {}),
                } },
                { Put: { TableName: Tables.ONBOARDING, Item: { ...versionRecord, sk: `VERSION#${workflow.workflowId}#${String(version).padStart(6, '0')}` }, ConditionExpression: 'attribute_not_exists(sk)' } },
            ]);
            return { status: 'saved', version };
        } catch (error) {
            if (!versionConflict(error)) throw error;
            const existing = await this.getVersion(orgId, workflow.workflowId, version);
            return { status: existing?.orgId === orgId && existing.workflowId === workflow.workflowId && existing.version === version && existing.saveKey === saveKey && existing.fingerprint === fingerprint ? 'replayed' : 'conflict', version };
        }
    }

    async activateVersion(orgId: string, workflowId: string, version: number, userId: string, now: string): Promise<boolean> {
        try {
            await this.ddb.transactWrite([
                { ConditionCheck: { TableName: Tables.ONBOARDING, Key: { orgId, sk: `VERSION#${workflowId}#${String(version).padStart(6, '0')}` }, ConditionExpression: 'attribute_exists(sk)' } },
                { Update: { TableName: Tables.ONBOARDING, Key: { orgId, sk: onboardingWorkflowSk(workflowId) },
                    UpdateExpression: 'SET activeVersion = :version, isActive = :active, updatedBy = :user, updatedAt = :now',
                    ConditionExpression: 'currentVersion = :version',
                    ExpressionAttributeValues: { ':version': version, ':active': true, ':user': userId, ':now': now },
                } },
            ]);
            return true;
        } catch (error) { if (versionConflict(error)) return false; throw error; }
    }

    listPage(orgId: string, options: WorkflowPageOptions & { search?: string; isActive?: boolean } = {}) {
        return workflowPage<OnboardingWorkflow>(this.ddb, orgId, 'WORKFLOW#', options, { search: options.search, isActive: options.isActive });
    }

    listVersionsPage(orgId: string, workflowId: string, options: WorkflowPageOptions = {}) {
        return workflowPage<WorkflowDefinitionVersion>(this.ddb, orgId, `VERSION#${workflowId}#`, options, { workflowId });
    }

    async list(orgId: string): Promise<OnboardingWorkflow[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'WORKFLOW#' },
        });
        return (Items as OnboardingWorkflow[]) ?? [];
    }

    /** Cheap count of an org's workflows (Select COUNT — no bodies fetched). */
    async countByOrg(orgId: string): Promise<number> {
        const { Count } = await this.ddb.query({
            TableName: Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'WORKFLOW#' },
            Select: 'COUNT',
        });
        return Count ?? 0;
    }

    async put(orgId: string, workflow: Omit<OnboardingWorkflow, 'orgId' | 'sk'>): Promise<void> {
        await this.ddb.put(Tables.ONBOARDING, {
            ...workflow,
            orgId,
            sk: onboardingWorkflowSk(workflow.workflowId),
        });
    }

    async delete(orgId: string, workflowId: string): Promise<void> {
        await this.ddb.delete(Tables.ONBOARDING, {
            orgId,
            sk: onboardingWorkflowSk(workflowId),
        });
    }
}

export interface IOnboardingWorkflowRepo extends Pick<OnboardingWorkflowDynamoRepo, keyof OnboardingWorkflowDynamoRepo> {}
export { OnboardingWorkflowRepo } from './factory';
