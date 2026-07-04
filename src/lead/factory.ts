import { resolveRoute, type Route } from '../dataBackend';
import { mirrorWrite, shadowRead } from '../dualWrite';
import { ddb } from '../ddbClient';
import type { IDdb } from '../ddbPort';
import { PaginatedResult } from '../types';
import { Lead } from './schema';
import { LeadDynamoRepo, type ILeadRepo } from './repo';
import { LeadPgRepo } from './repo.pg';

const DOMAIN = 'leads' as const;
const ENTITY = 'lead';
type PagParams = { orgId: string; limit?: number; exclusiveStartKey?: Record<string, any>; stage?: string; source?: string; search?: string };

export class RoutingLeadRepo implements ILeadRepo {
    constructor(private dynamo: ILeadRepo, private pg: ILeadRepo) {}
    private pick(r: Route): ILeadRepo { return r.primary === 'dynamo' ? this.dynamo : this.pg; }
    private mirrorOf(r: Route): ILeadRepo | undefined { return !r.mirror ? undefined : (r.mirror === 'dynamo' ? this.dynamo : this.pg); }
    private async mirrorEntity(route: Route, orgId: string, userId: string, leadId: string, op: string): Promise<void> {
        const m = this.mirrorOf(route); if (!m) return;
        await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op, key: { orgId, userId, leadId } }, async () => {
            const fresh = await this.pick(route).getLead(orgId, userId, leadId);
            if (fresh) await m.upsertLead(fresh); else await m.deleteLead(orgId, userId, leadId);
        });
    }
    private async read<T>(op: string, primary: () => Promise<T>, shadow: () => Promise<T>, r: Route): Promise<T> {
        const res = await primary(); if (r.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op }, res, shadow); return res;
    }
    async getLead(o: string, u: string, id: string) { const r = await resolveRoute(DOMAIN); return this.read('getLead', () => this.pick(r).getLead(o, u, id), () => this.pg.getLead(o, u, id), r); }
    async findLeadByIdInOrg(o: string, id: string) { const r = await resolveRoute(DOMAIN); return this.read('findLeadByIdInOrg', () => this.pick(r).findLeadByIdInOrg(o, id), () => this.pg.findLeadByIdInOrg(o, id), r); }
    async listUserLeads(o: string, u: string) { const r = await resolveRoute(DOMAIN); return this.read('listUserLeads', () => this.pick(r).listUserLeads(o, u), () => this.pg.listUserLeads(o, u), r); }
    async listAllOrgLeads(o: string) { const r = await resolveRoute(DOMAIN); return this.read('listAllOrgLeads', () => this.pick(r).listAllOrgLeads(o), () => this.pg.listAllOrgLeads(o), r); }
    async listOrgLeadsPaginated(p: PagParams): Promise<PaginatedResult<Lead>> { return this.pick(await resolveRoute(DOMAIN)).listOrgLeadsPaginated(p); }
    async findActiveLeadBySenderId(o: string, s: string) { const r = await resolveRoute(DOMAIN); return this.read('findActiveLeadBySenderId', () => this.pick(r).findActiveLeadBySenderId(o, s), () => this.pg.findActiveLeadBySenderId(o, s), r); }
    async countOrgLeads(o: string) { const r = await resolveRoute(DOMAIN); return this.read('countOrgLeads', () => this.pick(r).countOrgLeads(o), () => this.pg.countOrgLeads(o), r); }
    async listRecentLeads(o: string, s: string) { const r = await resolveRoute(DOMAIN); return this.read('listRecentLeads', () => this.pick(r).listRecentLeads(o, s), () => this.pg.listRecentLeads(o, s), r); }
    async findLeadsByPipelineId(o: string, p: string) { const r = await resolveRoute(DOMAIN); return this.read('findLeadsByPipelineId', () => this.pick(r).findLeadsByPipelineId(o, p), () => this.pg.findLeadsByPipelineId(o, p), r); }
    async listLeadsByStage(o: string, s: string) { const r = await resolveRoute(DOMAIN); return this.read('listLeadsByStage', () => this.pick(r).listLeadsByStage(o, s), () => this.pg.listLeadsByStage(o, s), r); }
    async createLead(o: string, u: string, id: string, d: Record<string, any>) { const r = await resolveRoute(DOMAIN); await this.pick(r).createLead(o, u, id, d); await this.mirrorEntity(r, o, u, id, 'createLead'); }
    async updateLead(o: string, u: string, id: string, upd: Record<string, any>) { const r = await resolveRoute(DOMAIN); await this.pick(r).updateLead(o, u, id, upd); await this.mirrorEntity(r, o, u, id, 'updateLead'); }
    async deleteLead(o: string, u: string, id: string) { const r = await resolveRoute(DOMAIN); await this.pick(r).deleteLead(o, u, id); const m = this.mirrorOf(r); if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'deleteLead', key: { orgId: o, userId: u, leadId: id } }, () => m.deleteLead(o, u, id)); }
    async upsertLead(lead: Lead) { const r = await resolveRoute(DOMAIN); await this.pick(r).upsertLead(lead); const m = this.mirrorOf(r); if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'upsertLead', key: { orgId: (lead as any).orgId, leadId: (lead as any).leadId } }, () => m.upsertLead(lead)); }
}

export class LeadRepo extends RoutingLeadRepo {
    constructor(dynamoDb: IDdb) { super(new LeadDynamoRepo(dynamoDb), new LeadPgRepo()); }
}
let singleton: ILeadRepo | undefined;
export function getLeadRepo(): ILeadRepo { if (!singleton) singleton = new LeadRepo(ddb); return singleton; }
