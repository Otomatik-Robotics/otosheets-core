import type { IDdb } from '../ddbPort';
import { workflowStorageMode } from '../workflowRuntime/storage';
import { WorkflowApprovalDynamoRepo, type IWorkflowApprovalRepo } from './repo';
import { WorkflowApprovalPgRepo } from './approval.pg';
export class WorkflowApprovalRepo implements IWorkflowApprovalRepo {
    private readonly dynamo: WorkflowApprovalDynamoRepo;
    private readonly pg = new WorkflowApprovalPgRepo();
    constructor(db: IDdb) { this.dynamo = new WorkflowApprovalDynamoRepo(db); }
    private async repo(): Promise<IWorkflowApprovalRepo> { return await workflowStorageMode() === 'pg' ? this.pg : this.dynamo; }
    async create(...args: Parameters<IWorkflowApprovalRepo['create']>): Promise<Awaited<ReturnType<IWorkflowApprovalRepo['create']>>> { return (await this.repo()).create(...args); }
    async get(...args: Parameters<IWorkflowApprovalRepo['get']>): Promise<Awaited<ReturnType<IWorkflowApprovalRepo['get']>>> { return (await this.repo()).get(...args); }
    async put(...args: Parameters<IWorkflowApprovalRepo['put']>): Promise<Awaited<ReturnType<IWorkflowApprovalRepo['put']>>> { return (await this.repo()).put(...args); }
    async decide(...args: Parameters<IWorkflowApprovalRepo['decide']>): Promise<Awaited<ReturnType<IWorkflowApprovalRepo['decide']>>> { return (await this.repo()).decide(...args); }
    async expire(...args: Parameters<IWorkflowApprovalRepo['expire']>): Promise<Awaited<ReturnType<IWorkflowApprovalRepo['expire']>>> { return (await this.repo()).expire(...args); }
    async listPendingPage(...args: Parameters<IWorkflowApprovalRepo['listPendingPage']>): Promise<Awaited<ReturnType<IWorkflowApprovalRepo['listPendingPage']>>> { return (await this.repo()).listPendingPage(...args); }
    async listPending(...args: Parameters<IWorkflowApprovalRepo['listPending']>): Promise<Awaited<ReturnType<IWorkflowApprovalRepo['listPending']>>> { return (await this.repo()).listPending(...args); }
    async resolve(...args: Parameters<IWorkflowApprovalRepo['resolve']>): Promise<Awaited<ReturnType<IWorkflowApprovalRepo['resolve']>>> { return (await this.repo()).resolve(...args); }
}
