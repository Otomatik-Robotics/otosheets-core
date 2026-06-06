import { IDdb } from '../ddbPort';
import { CompliancePlaybook, ComplianceTask } from './schema';
export declare class ComplianceRepo {
    private ddb;
    constructor(ddb: IDdb);
    getPlaybook(orgId: string): Promise<CompliancePlaybook | null>;
    putPlaybook(orgId: string, tasks: any, updatedBy?: string): Promise<void>;
    listTasks(orgId: string, userId?: string): Promise<ComplianceTask[]>;
    createTask(orgId: string, userId: string, taskId: string, data: Record<string, any>): Promise<void>;
    updateTask(orgId: string, userId: string, taskId: string, updates: Record<string, any>): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map