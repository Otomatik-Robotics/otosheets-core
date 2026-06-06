import { IDdb } from '../ddbPort';
import { RosterEntry } from './schema';
export declare class RosterEntryRepo {
    private ddb;
    constructor(ddb: IDdb);
    get(orgId: string, date: string, memberId: string): Promise<RosterEntry | null>;
    listByDateRange(orgId: string, from: string, to: string): Promise<RosterEntry[]>;
    listByDate(orgId: string, date: string): Promise<RosterEntry[]>;
    create(orgId: string, rosterId: string, data: Record<string, any>): Promise<void>;
    update(orgId: string, date: string, memberId: string, updates: Record<string, any>): Promise<void>;
    delete(orgId: string, date: string, memberId: string): Promise<void>;
    batchCreate(orgId: string, entries: Array<{
        rosterId: string;
    } & Record<string, any>>): Promise<void>;
    bulkUpdateStatus(orgId: string, entries: Array<{
        date: string;
        memberId: string;
    }>, status: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map