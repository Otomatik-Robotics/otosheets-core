import { IDdb } from '../ddbPort';
import { AvailabilityRule } from './schema';
export declare class AvailabilityRuleRepo {
    private ddb;
    constructor(ddb: IDdb);
    listByMember(orgId: string, memberId: string): Promise<AvailabilityRule[]>;
    listByOrg(orgId: string): Promise<AvailabilityRule[]>;
    put(orgId: string, memberId: string, ruleId: string, data: Record<string, any>): Promise<void>;
    delete(orgId: string, memberId: string, ruleId: string): Promise<void>;
    deleteAllForMember(orgId: string, memberId: string): Promise<void>;
    replaceAllForMember(orgId: string, memberId: string, rules: Array<{
        ruleId: string;
    } & Record<string, any>>): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map