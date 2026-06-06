import { IDdb } from '../ddbPort';
import { OnboardingWorkflow } from './schema';
export declare class OnboardingWorkflowRepo {
    private ddb;
    constructor(ddb: IDdb);
    get(orgId: string, workflowId: string): Promise<OnboardingWorkflow | null>;
    list(orgId: string): Promise<OnboardingWorkflow[]>;
    put(orgId: string, workflow: Omit<OnboardingWorkflow, 'orgId' | 'sk'>): Promise<void>;
    delete(orgId: string, workflowId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map