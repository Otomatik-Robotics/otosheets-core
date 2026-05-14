import { IDdb } from '../ddbPort';
import { Membership } from './schema';
export declare class MembershipRepo {
    private ddb;
    constructor(ddb: IDdb);
    getMembership(orgId: string, userId: string): Promise<Membership | null>;
    listOrgMembers(orgId: string): Promise<Membership[]>;
    listUserOrgs(userId: string): Promise<Membership[]>;
    getByInviteToken(token: string): Promise<Membership | null>;
    createMembership(orgId: string, userId: string, data: Record<string, any>): Promise<void>;
    updateMembership(orgId: string, userId: string, updates: Record<string, any>): Promise<void>;
    deleteMembership(orgId: string, userId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map