import { and, eq, sql, desc, lt, or, gte, lte } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { jobs } from '../pg/schema/opsEntities';
import { keysetFromStartKey, keysetStartKey } from '../pg/cursor';
import { dtoToRow, rowToDto, ownerFromSk } from '../pg/billingRows';
import { PaginatedResult } from '../types';
import { Job } from './schema';
import type { IJobRepo } from './repo';

const NUM: string[] = [];
const PG_ONLY = ['ownerId'];
const STRIP = ['sk', 'scheduledDateSk'];

function toDto(row: any): Job {
    const dto = rowToDto<any>(row, NUM, PG_ONLY);
    dto.sk = `${row.ownerId}#${row.jobId}`;
    if (row.scheduledDate) dto.scheduledDateSk = `${row.scheduledDate}#${row.jobId}`;
    return dto as Job;
}

export class JobPgRepo implements IJobRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    async getJob(orgId: string, _u: string, jobId: string): Promise<Job | null> {
        const r = await this.db.select().from(jobs).where(and(eq(jobs.orgId, orgId), eq(jobs.jobId, jobId))).limit(1);
        return r[0] ? toDto(r[0]) : null;
    }
    async findJobByIdInOrg(orgId: string, jobId: string) {
        const r = await this.db.select().from(jobs).where(and(eq(jobs.orgId, orgId), eq(jobs.jobId, jobId))).limit(1);
        return r[0] ? { job: toDto(r[0]), ownerId: (r[0] as any).ownerId } : null;
    }
    async listUserJobs(orgId: string, userId: string): Promise<Job[]> {
        const r = await this.db.select().from(jobs).where(and(eq(jobs.orgId, orgId), eq(jobs.ownerId, userId)));
        return r.map(toDto);
    }
    async listAllOrgJobs(orgId: string): Promise<Job[]> {
        const r = await this.db.select().from(jobs).where(eq(jobs.orgId, orgId));
        return r.map(toDto);
    }
    async listJobsByDate(orgId: string, from: string, to: string): Promise<Job[]> {
        const r = await this.db.select().from(jobs).where(and(eq(jobs.orgId, orgId), gte(jobs.scheduledDate, from), lte(jobs.scheduledDate, to)));
        return r.map(toDto);
    }
    async listOrgJobsPaginated(params: { orgId: string; limit?: number; exclusiveStartKey?: Record<string, any>; status?: string; clientId?: string; search?: string; memberId?: string; dateFrom?: string; dateTo?: string; }): Promise<PaginatedResult<Job>> {
        const { orgId, limit = 20, exclusiveStartKey, status, clientId, search, memberId, dateFrom, dateTo } = params;
        const conds: any[] = [eq(jobs.orgId, orgId)];
        if (status) conds.push(eq(jobs.status, status));
        if (clientId) conds.push(eq(jobs.clientId, clientId));
        if (search) { const like = `%${search}%`; conds.push(or(sql`${jobs.title} ILIKE ${like}`, sql`${jobs.address} ILIKE ${like}`)); }
        if (memberId) conds.push(sql`${jobs.assignedMembers} @> ${JSON.stringify([memberId])}::jsonb`);
        if (dateFrom) conds.push(gte(jobs.scheduledDate, dateFrom));
        if (dateTo) conds.push(lte(jobs.scheduledDate, dateTo));
        const cur = keysetFromStartKey(exclusiveStartKey, 'jobId');
        if (cur) conds.push(or(lt(jobs.createdAt, new Date(cur.createdAt)), and(eq(jobs.createdAt, new Date(cur.createdAt)), lt(jobs.jobId, cur.id))));
        const rows = await this.db.select().from(jobs).where(and(...conds)).orderBy(desc(jobs.createdAt), desc(jobs.jobId)).limit(limit);
        const last = rows[rows.length - 1] as any;
        const lek = rows.length === limit && last ? keysetStartKey({ createdAt: (last.createdAt as Date).toISOString(), id: last.jobId }) : undefined;
        return { items: rows.map(toDto), lastEvaluatedKey: lek };
    }
    async createJob(orgId: string, userId: string, jobId: string, data: Record<string, any>): Promise<void> {
        const now = new Date();
        await this.db.insert(jobs).values({ ...dtoToRow(data, NUM, STRIP), orgId, jobId, ownerId: userId, createdBy: userId, createdAt: now, updatedAt: now } as any);
    }
    async updateJob(orgId: string, _u: string, jobId: string, updates: Record<string, any>): Promise<void> {
        await this.db.update(jobs).set({ ...dtoToRow(updates, NUM, STRIP), updatedAt: new Date() } as any).where(and(eq(jobs.orgId, orgId), eq(jobs.jobId, jobId)));
    }
    async deleteJob(orgId: string, _u: string, jobId: string): Promise<void> {
        await this.db.delete(jobs).where(and(eq(jobs.orgId, orgId), eq(jobs.jobId, jobId)));
    }
    async upsertJob(job: Job): Promise<void> {
        const row = { ...dtoToRow(job as Record<string, any>, NUM, STRIP), ownerId: ownerFromSk(job as any) };
        await this.db.insert(jobs).values(row as any).onConflictDoUpdate({ target: jobs.jobId, set: row as any, setWhere: sql`${jobs.updatedAt} <= excluded.updated_at` });
    }
}
