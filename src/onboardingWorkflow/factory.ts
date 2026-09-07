import type { IDdb } from '../ddbPort';
import { workflowStorageMode } from '../workflowRuntime/storage';
import { OnboardingWorkflowDynamoRepo, type IOnboardingWorkflowRepo } from './repo';
import { OnboardingWorkflowPgRepo } from './repo.pg';
export class OnboardingWorkflowRepo implements IOnboardingWorkflowRepo {
    private readonly dynamo: OnboardingWorkflowDynamoRepo;
    private readonly pg = new OnboardingWorkflowPgRepo();
    constructor(db: IDdb) { this.dynamo = new OnboardingWorkflowDynamoRepo(db); }
    private async repo(): Promise<IOnboardingWorkflowRepo> { return await workflowStorageMode() === 'pg' ? this.pg : this.dynamo; }
    async get(...args: Parameters<IOnboardingWorkflowRepo['get']>): Promise<Awaited<ReturnType<IOnboardingWorkflowRepo['get']>>> { return (await this.repo()).get(...args); }
    async getVersion(...args: Parameters<IOnboardingWorkflowRepo['getVersion']>): Promise<Awaited<ReturnType<IOnboardingWorkflowRepo['getVersion']>>> { return (await this.repo()).getVersion(...args); }
    async saveVersion(...args: Parameters<IOnboardingWorkflowRepo['saveVersion']>): Promise<Awaited<ReturnType<IOnboardingWorkflowRepo['saveVersion']>>> { return (await this.repo()).saveVersion(...args); }
    async activateVersion(...args: Parameters<IOnboardingWorkflowRepo['activateVersion']>): Promise<Awaited<ReturnType<IOnboardingWorkflowRepo['activateVersion']>>> { return (await this.repo()).activateVersion(...args); }
    async listPage(...args: Parameters<IOnboardingWorkflowRepo['listPage']>): Promise<Awaited<ReturnType<IOnboardingWorkflowRepo['listPage']>>> { return (await this.repo()).listPage(...args); }
    async listVersionsPage(...args: Parameters<IOnboardingWorkflowRepo['listVersionsPage']>): Promise<Awaited<ReturnType<IOnboardingWorkflowRepo['listVersionsPage']>>> { return (await this.repo()).listVersionsPage(...args); }
    async list(...args: Parameters<IOnboardingWorkflowRepo['list']>): Promise<Awaited<ReturnType<IOnboardingWorkflowRepo['list']>>> { return (await this.repo()).list(...args); }
    async countByOrg(...args: Parameters<IOnboardingWorkflowRepo['countByOrg']>): Promise<Awaited<ReturnType<IOnboardingWorkflowRepo['countByOrg']>>> { return (await this.repo()).countByOrg(...args); }
    async put(...args: Parameters<IOnboardingWorkflowRepo['put']>): Promise<Awaited<ReturnType<IOnboardingWorkflowRepo['put']>>> { return (await this.repo()).put(...args); }
    async delete(...args: Parameters<IOnboardingWorkflowRepo['delete']>): Promise<Awaited<ReturnType<IOnboardingWorkflowRepo['delete']>>> { return (await this.repo()).delete(...args); }
}
