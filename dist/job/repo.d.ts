import { IDdb } from '../ddbPort';
import { Job } from './schema';
import { PaginatedResult } from '../types';
export declare class JobRepo {
    private ddb;
    constructor(ddb: IDdb);
    getJob(orgId: string, userId: string, jobId: string): Promise<Job | null>;
    findJobByIdInOrg(orgId: string, jobId: string): Promise<{
        job: Job;
        ownerId: string;
    } | null>;
    listUserJobs(orgId: string, userId: string): Promise<Job[]>;
    listAllOrgJobs(orgId: string): Promise<Job[]>;
    listJobsByDate(orgId: string, from: string, to: string): Promise<Job[]>;
    listOrgJobsPaginated(params: {
        orgId: string;
        limit?: number;
        exclusiveStartKey?: Record<string, any>;
        status?: string;
        clientId?: string;
        search?: string;
        memberId?: string;
        dateFrom?: string;
        dateTo?: string;
    }): Promise<PaginatedResult<Job>>;
    createJob(orgId: string, userId: string, jobId: string, data: Record<string, any>): Promise<void>;
    updateJob(orgId: string, userId: string, jobId: string, updates: Record<string, any>): Promise<void>;
    deleteJob(orgId: string, userId: string, jobId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map