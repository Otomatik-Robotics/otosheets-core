import type { IDdb } from '../ddbPort';
import { workflowStorageMode } from './storage';
import { WorkflowRuntimeDynamoRepo, WorkflowDueDynamoRepo, type IWorkflowRuntimeRepo, type IWorkflowDueRepo } from './repo';
import { WorkflowRuntimePgRepo, WorkflowDuePgRepo } from './repo.pg';
export class WorkflowRuntimeRepo implements IWorkflowRuntimeRepo {
    private readonly dynamo: WorkflowRuntimeDynamoRepo;
    private readonly pg = new WorkflowRuntimePgRepo();
    constructor(db: IDdb) { this.dynamo = new WorkflowRuntimeDynamoRepo(db); }
    private async repo(): Promise<IWorkflowRuntimeRepo> { return await workflowStorageMode() === 'pg' ? this.pg : this.dynamo; }
    async get(...args: Parameters<IWorkflowRuntimeRepo['get']>): Promise<Awaited<ReturnType<IWorkflowRuntimeRepo['get']>>> { return (await this.repo()).get(...args); }
    async create(...args: Parameters<IWorkflowRuntimeRepo['create']>): Promise<Awaited<ReturnType<IWorkflowRuntimeRepo['create']>>> { return (await this.repo()).create(...args); }
    async acquire(...args: Parameters<IWorkflowRuntimeRepo['acquire']>): Promise<Awaited<ReturnType<IWorkflowRuntimeRepo['acquire']>>> { return (await this.repo()).acquire(...args); }
    async finish(...args: Parameters<IWorkflowRuntimeRepo['finish']>): Promise<Awaited<ReturnType<IWorkflowRuntimeRepo['finish']>>> { return (await this.repo()).finish(...args); }
    async getStep(...args: Parameters<IWorkflowRuntimeRepo['getStep']>): Promise<Awaited<ReturnType<IWorkflowRuntimeRepo['getStep']>>> { return (await this.repo()).getStep(...args); }
    async startStep(...args: Parameters<IWorkflowRuntimeRepo['startStep']>): Promise<Awaited<ReturnType<IWorkflowRuntimeRepo['startStep']>>> { return (await this.repo()).startStep(...args); }
    async finishStep(...args: Parameters<IWorkflowRuntimeRepo['finishStep']>): Promise<Awaited<ReturnType<IWorkflowRuntimeRepo['finishStep']>>> { return (await this.repo()).finishStep(...args); }
    async wait(...args: Parameters<IWorkflowRuntimeRepo['wait']>): Promise<Awaited<ReturnType<IWorkflowRuntimeRepo['wait']>>> { return (await this.repo()).wait(...args); }
    async putWake(...args: Parameters<IWorkflowRuntimeRepo['putWake']>): Promise<Awaited<ReturnType<IWorkflowRuntimeRepo['putWake']>>> { return (await this.repo()).putWake(...args); }
    async getWake(...args: Parameters<IWorkflowRuntimeRepo['getWake']>): Promise<Awaited<ReturnType<IWorkflowRuntimeRepo['getWake']>>> { return (await this.repo()).getWake(...args); }
    async removeWake(...args: Parameters<IWorkflowRuntimeRepo['removeWake']>): Promise<Awaited<ReturnType<IWorkflowRuntimeRepo['removeWake']>>> { return (await this.repo()).removeWake(...args); }
    async listRunsPage(...args: Parameters<IWorkflowRuntimeRepo['listRunsPage']>): Promise<Awaited<ReturnType<IWorkflowRuntimeRepo['listRunsPage']>>> { return (await this.repo()).listRunsPage(...args); }
    async listStepsPage(...args: Parameters<IWorkflowRuntimeRepo['listStepsPage']>): Promise<Awaited<ReturnType<IWorkflowRuntimeRepo['listStepsPage']>>> { return (await this.repo()).listStepsPage(...args); }
    async listExecutionLogsPage(...args: Parameters<IWorkflowRuntimeRepo['listExecutionLogsPage']>): Promise<Awaited<ReturnType<IWorkflowRuntimeRepo['listExecutionLogsPage']>>> { return (await this.repo()).listExecutionLogsPage(...args); }
    async resolveDeliveryReview(...args: Parameters<IWorkflowRuntimeRepo['resolveDeliveryReview']>): Promise<Awaited<ReturnType<IWorkflowRuntimeRepo['resolveDeliveryReview']>>> { return (await this.repo()).resolveDeliveryReview(...args); }
    async submitInputs(...args: Parameters<IWorkflowRuntimeRepo['submitInputs']>): Promise<Awaited<ReturnType<IWorkflowRuntimeRepo['submitInputs']>>> { return (await this.repo()).submitInputs(...args); }
}
export class WorkflowDueRepo implements IWorkflowDueRepo {
    private readonly dynamo: WorkflowDueDynamoRepo;
    private readonly pg = new WorkflowDuePgRepo();
    constructor(db: IDdb) { this.dynamo = new WorkflowDueDynamoRepo(db); }
    private async repo(): Promise<IWorkflowDueRepo> { return await workflowStorageMode() === 'pg' ? this.pg : this.dynamo; }
    async listDue(...args: Parameters<IWorkflowDueRepo['listDue']>): Promise<Awaited<ReturnType<IWorkflowDueRepo['listDue']>>> { return (await this.repo()).listDue(...args); }
}
