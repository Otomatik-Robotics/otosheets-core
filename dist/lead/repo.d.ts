import { IDdb } from '../ddbPort';
import { Lead } from './schema';
import { PaginatedResult } from '../types';
export declare class LeadRepo {
    private ddb;
    constructor(ddb: IDdb);
    getLead(orgId: string, userId: string, leadId: string): Promise<Lead | null>;
    findLeadByIdInOrg(orgId: string, leadId: string): Promise<{
        lead: Lead;
        ownerId: string;
    } | null>;
    listUserLeads(orgId: string, userId: string): Promise<Lead[]>;
    listAllOrgLeads(orgId: string): Promise<Lead[]>;
    listOrgLeadsPaginated(params: {
        orgId: string;
        limit?: number;
        exclusiveStartKey?: Record<string, any>;
        stage?: string;
        source?: string;
        search?: string;
    }): Promise<PaginatedResult<Lead>>;
    findActiveLeadBySenderId(orgId: string, senderId: string): Promise<Lead | null>;
    listLeadsByStage(orgId: string, stage: string): Promise<Lead[]>;
    createLead(orgId: string, userId: string, leadId: string, data: Record<string, any>): Promise<void>;
    updateLead(orgId: string, userId: string, leadId: string, updates: Record<string, any>): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map