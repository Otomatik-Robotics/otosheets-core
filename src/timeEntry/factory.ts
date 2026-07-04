import { resolveRoute, type Route } from '../dataBackend';
import { mirrorWrite, shadowRead } from '../dualWrite';
import { ddb } from '../ddbClient';
import type { IDdb } from '../ddbPort';
import { PaginatedResult } from '../types';
import { TimeEntry } from './schema';
import { TimeEntryDynamoRepo, type ITimeEntryRepo } from './repo';
import { TimeEntryPgRepo } from './repo.pg';

const DOMAIN = 'ops' as const, ENTITY = 'timeEntry';
type PP = { orgId: string; limit?: number; exclusiveStartKey?: Record<string, any>; clientId?: string; from?: string; to?: string; uninvoiced?: boolean; search?: string };

export class RoutingTimeEntryRepo implements ITimeEntryRepo {
    constructor(private dynamo: ITimeEntryRepo, private pg: ITimeEntryRepo) {}
    private pick(r: Route) { return r.primary === 'dynamo' ? this.dynamo : this.pg; }
    private mirrorOf(r: Route) { return !r.mirror ? undefined : (r.mirror === 'dynamo' ? this.dynamo : this.pg); }
    private async mE(route: Route, o: string, u: string, id: string, op: string) { const m = this.mirrorOf(route); if (!m) return; await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op, key: { orgId: o, userId: u, timeEntryId: id } }, async () => { const f = await this.pick(route).getTimeEntry(o, u, id); if (f) await m.upsertTimeEntry(f); else await m.deleteTimeEntry(o, u, id); }); }
    private async rd<T>(op: string, p: () => Promise<T>, s: () => Promise<T>, r: Route): Promise<T> { const res = await p(); if (r.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op }, res, s); return res; }
    async getTimeEntry(o: string, u: string, id: string) { const r = await resolveRoute(DOMAIN); return this.rd('getTimeEntry', () => this.pick(r).getTimeEntry(o, u, id), () => this.pg.getTimeEntry(o, u, id), r); }
    async findTimeEntryByIdInOrg(o: string, id: string) { const r = await resolveRoute(DOMAIN); return this.rd('findTimeEntryByIdInOrg', () => this.pick(r).findTimeEntryByIdInOrg(o, id), () => this.pg.findTimeEntryByIdInOrg(o, id), r); }
    async listAllOrgTimeEntries(o: string) { const r = await resolveRoute(DOMAIN); return this.rd('listAllOrgTimeEntries', () => this.pick(r).listAllOrgTimeEntries(o), () => this.pg.listAllOrgTimeEntries(o), r); }
    async listTimeEntries(o: string, u: string, opts?: { uninvoiced?: boolean }) { const r = await resolveRoute(DOMAIN); return this.rd('listTimeEntries', () => this.pick(r).listTimeEntries(o, u, opts), () => this.pg.listTimeEntries(o, u, opts), r); }
    async listOrgTimeEntriesPaginated(p: PP): Promise<PaginatedResult<TimeEntry>> { return this.pick(await resolveRoute(DOMAIN)).listOrgTimeEntriesPaginated(p); }
    async createTimeEntry(o: string, u: string, id: string, d: Record<string, any>) { const r = await resolveRoute(DOMAIN); await this.pick(r).createTimeEntry(o, u, id, d); await this.mE(r, o, u, id, 'createTimeEntry'); }
    async updateTimeEntry(o: string, u: string, id: string, upd: Record<string, any>) { const r = await resolveRoute(DOMAIN); await this.pick(r).updateTimeEntry(o, u, id, upd); await this.mE(r, o, u, id, 'updateTimeEntry'); }
    async deleteTimeEntry(o: string, u: string, id: string) { const r = await resolveRoute(DOMAIN); await this.pick(r).deleteTimeEntry(o, u, id); const m = this.mirrorOf(r); if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'deleteTimeEntry', key: { orgId: o, userId: u, timeEntryId: id } }, () => m.deleteTimeEntry(o, u, id)); }
    async upsertTimeEntry(te: TimeEntry) { const r = await resolveRoute(DOMAIN); await this.pick(r).upsertTimeEntry(te); const m = this.mirrorOf(r); if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'upsertTimeEntry', key: { orgId: (te as any).orgId, timeEntryId: (te as any).timeEntryId } }, () => m.upsertTimeEntry(te)); }
}
export class TimeEntryRepo extends RoutingTimeEntryRepo { constructor(d: IDdb) { super(new TimeEntryDynamoRepo(d), new TimeEntryPgRepo()); } }
let s: ITimeEntryRepo | undefined; export function getTimeEntryRepo(): ITimeEntryRepo { if (!s) s = new TimeEntryRepo(ddb); return s; }
