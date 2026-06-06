import { IDdb } from '../ddbPort';
import { Organization } from './schema';
export declare class OrgRepo {
    private ddb;
    constructor(ddb: IDdb);
    getOrg(orgId: string): Promise<Organization | null>;
    getOrgBySlug(slug: string): Promise<Organization | null>;
    createOrg(orgId: string, data: Record<string, any>): Promise<void>;
    updateOrg(orgId: string, updates: Record<string, any>): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map