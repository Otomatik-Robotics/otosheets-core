import { IDdb } from '../ddbPort';
import { TimeEntry } from './schema';
export declare class TimeEntryRepo {
    private ddb;
    constructor(ddb: IDdb);
    getTimeEntry(orgId: string, userId: string, timeEntryId: string): Promise<TimeEntry | null>;
    findTimeEntryByIdInOrg(orgId: string, timeEntryId: string): Promise<{
        timeEntry: TimeEntry;
        ownerId: string;
    } | null>;
    listAllOrgTimeEntries(orgId: string): Promise<TimeEntry[]>;
    listTimeEntries(orgId: string, userId: string, opts?: {
        uninvoiced?: boolean;
    }): Promise<TimeEntry[]>;
    createTimeEntry(orgId: string, userId: string, timeEntryId: string, data: Record<string, any>): Promise<void>;
    updateTimeEntry(orgId: string, userId: string, timeEntryId: string, updates: Record<string, any>): Promise<void>;
    deleteTimeEntry(orgId: string, userId: string, timeEntryId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map