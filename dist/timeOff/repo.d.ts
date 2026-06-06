import { IDdb } from '../ddbPort';
import { TimeOff } from './schema';
export declare class TimeOffRepo {
    private ddb;
    constructor(ddb: IDdb);
    get(orgId: string, memberId: string, timeOffId: string): Promise<TimeOff | null>;
    listByMember(orgId: string, memberId: string): Promise<TimeOff[]>;
    listByOrg(orgId: string): Promise<TimeOff[]>;
    create(orgId: string, memberId: string, timeOffId: string, data: Record<string, any>): Promise<void>;
    update(orgId: string, memberId: string, timeOffId: string, updates: Record<string, any>): Promise<void>;
    delete(orgId: string, memberId: string, timeOffId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map