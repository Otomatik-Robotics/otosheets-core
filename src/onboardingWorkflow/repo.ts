import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { onboardingWorkflowSk } from '../keys';
import { OnboardingWorkflow } from './schema';

export class OnboardingWorkflowRepo {
    constructor(private ddb: IDdb) {}

    async get(orgId: string, workflowId: string): Promise<OnboardingWorkflow | null> {
        const { Item } = await this.ddb.getItem(Tables.ONBOARDING, {
            orgId,
            sk: onboardingWorkflowSk(workflowId),
        });
        return (Item as OnboardingWorkflow) ?? null;
    }

    async list(orgId: string): Promise<OnboardingWorkflow[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'WORKFLOW#' },
        });
        return (Items as OnboardingWorkflow[]) ?? [];
    }

    async put(orgId: string, workflow: Omit<OnboardingWorkflow, 'orgId' | 'sk'>): Promise<void> {
        await this.ddb.put(Tables.ONBOARDING, {
            orgId,
            sk: onboardingWorkflowSk(workflow.workflowId),
            ...workflow,
        });
    }

    async delete(orgId: string, workflowId: string): Promise<void> {
        await this.ddb.delete(Tables.ONBOARDING, {
            orgId,
            sk: onboardingWorkflowSk(workflowId),
        });
    }
}
