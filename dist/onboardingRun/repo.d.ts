import { IDdb } from '../ddbPort';
import { WorkflowRun, WorkflowApproval } from './schema';
export declare class WorkflowRunRepo {
    private ddb;
    constructor(ddb: IDdb);
    get(orgId: string, membershipId: string): Promise<WorkflowRun | null>;
    list(orgId: string): Promise<WorkflowRun[]>;
    put(orgId: string, run: Omit<WorkflowRun, 'orgId' | 'sk'>): Promise<void>;
    listRuns(orgId: string): Promise<WorkflowRun[]>;
    getRun(orgId: string, runId: string): Promise<WorkflowRun | null>;
    listRunsByWorkflow(orgId: string, workflowId: string, limit: number): Promise<WorkflowRun[]>;
    listRunsByOrg(orgId: string, limit: number): Promise<WorkflowRun[]>;
    update(orgId: string, membershipId: string, updates: Record<string, any>): Promise<void>;
}
/** @deprecated Use WorkflowRunRepo */
export { WorkflowRunRepo as OnboardingRunRepo };
export declare class WorkflowApprovalRepo {
    private ddb;
    constructor(ddb: IDdb);
    put(approval: Omit<WorkflowApproval, 'sk'>): Promise<void>;
    get(orgId: string, approvalId: string): Promise<WorkflowApproval | null>;
    listPending(orgId: string): Promise<WorkflowApproval[]>;
    resolve(orgId: string, approvalId: string, status: 'approved' | 'rejected', resolvedBy: string, comment?: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map