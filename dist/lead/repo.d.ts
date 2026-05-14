import { IDdb } from '../ddbPort';
import { Lead } from './schema';
export declare class LeadRepo {
    private ddb;
    constructor(ddb: IDdb);
    getLead(orgId: string, userId: string, leadId: string): Promise<Lead | null>;
    listUserLeads(orgId: string, userId: string): Promise<Lead[]>;
    listAllOrgLeads(orgId: string): Promise<Lead[]>;
    listLeadsByStage(orgId: string, stage: string): Promise<Lead[]>;
    createLead(orgId: string, userId: string, leadId: string, data: Record<string, any>): Promise<void>;
    updateLead(orgId: string, userId: string, leadId: string, updates: Record<string, any>): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map