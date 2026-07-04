import { resolveRoute, type Route } from '../dataBackend';
import { mirrorWrite, shadowRead } from '../dualWrite';
import { ddb } from '../ddbClient';
import type { IDdb } from '../ddbPort';
import { PaginatedResult } from '../types';
import { Job } from './schema';
import { JobDynamoRepo, type IJobRepo } from './repo';
import { JobPgRepo } from './repo.pg';

const DOMAIN = 'ops' as const, ENTITY = 'job';
type PP = { orgId: string; limit?: number; exclusiveStartKey?: Record<string, any>; status?: string; clientId?: string; search?: string; memberId?: string; dateFrom?: string; dateTo?: string };

export class RoutingJobRepo implements IJobRepo {
    constructor(private dynamo: IJobRepo, private pg: IJobRepo) {}
    private pick(r: Route) { return r.primary === 'dynamo' ? this.dynamo : this.pg; }
    private mirrorOf(r: Route) { return !r.mirror ? undefined : (r.mirror === 'dynamo' ? this.dynamo : this.pg); }
    private async mE(route: Route, o: string, u: string, id: string, op: string) { const m = this.mirrorOf(route); if (!m) return; await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op, key: { orgId: o, userId: u, jobId: id } }, async () => { const f = await this.pick(route).getJob(o, u, id); if (f) await m.upsertJob(f); else await m.deleteJob(o, u, id); }); }
    private async rd<T>(op: string, p: () => Promise<T>, s: () => Promise<T>, r: Route): Promise<T> { const res = await p(); if (r.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op }, res, s); return res; }
    async getJob(o: string, u: string, id: string) { const r = await resolveRoute(DOMAIN); return this.rd('getJob', () => this.pick(r).getJob(o, u, id), () => this.pg.getJob(o, u, id), r); }
    async findJobByIdInOrg(o: string, id: string) { const r = await resolveRoute(DOMAIN); return this.rd('findJobByIdInOrg', () => this.pick(r).findJobByIdInOrg(o, id), () => this.pg.findJobByIdInOrg(o, id), r); }
    async listUserJobs(o: string, u: string) { const r = await resolveRoute(DOMAIN); return this.rd('listUserJobs', () => this.pick(r).listUserJobs(o, u), () => this.pg.listUserJobs(o, u), r); }
    async listAllOrgJobs(o: string) { const r = await resolveRoute(DOMAIN); return this.rd('listAllOrgJobs', () => this.pick(r).listAllOrgJobs(o), () => this.pg.listAllOrgJobs(o), r); }
    async listJobsByDate(o: string, f: string, t: string) { const r = await resolveRoute(DOMAIN); return this.rd('listJobsByDate', () => this.pick(r).listJobsByDate(o, f, t), () => this.pg.listJobsByDate(o, f, t), r); }
    async listOrgJobsPaginated(p: PP): Promise<PaginatedResult<Job>> { return this.pick(await resolveRoute(DOMAIN)).listOrgJobsPaginated(p); }
    async createJob(o: string, u: string, id: string, d: Record<string, any>) { const r = await resolveRoute(DOMAIN); await this.pick(r).createJob(o, u, id, d); await this.mE(r, o, u, id, 'createJob'); }
    async updateJob(o: string, u: string, id: string, upd: Record<string, any>) { const r = await resolveRoute(DOMAIN); await this.pick(r).updateJob(o, u, id, upd); await this.mE(r, o, u, id, 'updateJob'); }
    async deleteJob(o: string, u: string, id: string) { const r = await resolveRoute(DOMAIN); await this.pick(r).deleteJob(o, u, id); const m = this.mirrorOf(r); if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'deleteJob', key: { orgId: o, userId: u, jobId: id } }, () => m.deleteJob(o, u, id)); }
    async upsertJob(job: Job) { const r = await resolveRoute(DOMAIN); await this.pick(r).upsertJob(job); const m = this.mirrorOf(r); if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'upsertJob', key: { orgId: (job as any).orgId, jobId: (job as any).jobId } }, () => m.upsertJob(job)); }
}
export class JobRepo extends RoutingJobRepo { constructor(d: IDdb) { super(new JobDynamoRepo(d), new JobPgRepo()); } }
let s: IJobRepo | undefined; export function getJobRepo(): IJobRepo { if (!s) s = new JobRepo(ddb); return s; }
