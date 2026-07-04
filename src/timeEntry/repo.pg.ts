import { and, eq, sql, desc, lt, or, gte, lte, isNull } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { timeEntries } from '../pg/schema/opsEntities';
import { keysetFromStartKey, keysetStartKey } from '../pg/cursor';
import { dtoToRow, rowToDto, ownerFromSk } from '../pg/billingRows';
import { PaginatedResult } from '../types';
import { TimeEntry } from './schema';
import type { ITimeEntryRepo } from './repo';

const NUM: string[] = [];
const PG_ONLY = ['ownerId'];
const STRIP = ['sk'];
const toDto = (row: any): TimeEntry => { const d = rowToDto<any>(row, NUM, PG_ONLY); d.sk = `${row.ownerId}#${row.timeEntryId}`; return d as TimeEntry; };

export class TimeEntryPgRepo implements ITimeEntryRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    async getTimeEntry(o: string, _u: string, id: string) { const r = await this.db.select().from(timeEntries).where(and(eq(timeEntries.orgId, o), eq(timeEntries.timeEntryId, id))).limit(1); return r[0] ? toDto(r[0]) : null; }
    async findTimeEntryByIdInOrg(o: string, id: string) { const r = await this.db.select().from(timeEntries).where(and(eq(timeEntries.orgId, o), eq(timeEntries.timeEntryId, id))).limit(1); return r[0] ? { timeEntry: toDto(r[0]), ownerId: (r[0] as any).ownerId } : null; }
    async listAllOrgTimeEntries(o: string) { return (await this.db.select().from(timeEntries).where(eq(timeEntries.orgId, o))).map(toDto); }
    async listTimeEntries(o: string, userId: string, opts?: { uninvoiced?: boolean }) {
        const conds: any[] = [eq(timeEntries.orgId, o), eq(timeEntries.ownerId, userId)];
        if (opts?.uninvoiced) conds.push(isNull(timeEntries.invoicedAt));
        return (await this.db.select().from(timeEntries).where(and(...conds))).map(toDto);
    }
    async listOrgTimeEntriesPaginated(params: { orgId: string; limit?: number; exclusiveStartKey?: Record<string, any>; clientId?: string; from?: string; to?: string; uninvoiced?: boolean; search?: string; }): Promise<PaginatedResult<TimeEntry>> {
        const { orgId, limit = 20, exclusiveStartKey, clientId, from, to, uninvoiced, search } = params;
        const conds: any[] = [eq(timeEntries.orgId, orgId)];
        if (clientId) conds.push(eq(timeEntries.clientId, clientId));
        if (from) conds.push(gte(timeEntries.date, from));
        if (to) conds.push(lte(timeEntries.date, to));
        if (uninvoiced) conds.push(isNull(timeEntries.invoicedAt));
        if (search) conds.push(sql`${timeEntries.description} ILIKE ${`%${search}%`}`);
        const cur = keysetFromStartKey(exclusiveStartKey, 'timeEntryId');
        if (cur) conds.push(or(lt(timeEntries.createdAt, new Date(cur.createdAt)), and(eq(timeEntries.createdAt, new Date(cur.createdAt)), lt(timeEntries.timeEntryId, cur.id))));
        const rows = await this.db.select().from(timeEntries).where(and(...conds)).orderBy(desc(timeEntries.createdAt), desc(timeEntries.timeEntryId)).limit(limit);
        const last = rows[rows.length - 1] as any;
        const lek = rows.length === limit && last ? keysetStartKey({ createdAt: (last.createdAt as Date).toISOString(), id: last.timeEntryId }) : undefined;
        return { items: rows.map(toDto), lastEvaluatedKey: lek };
    }
    async createTimeEntry(o: string, u: string, id: string, data: Record<string, any>) { const now = new Date(); await this.db.insert(timeEntries).values({ ...dtoToRow(data, NUM, STRIP), orgId: o, timeEntryId: id, ownerId: u, createdBy: u, createdAt: now, updatedAt: now } as any); }
    async updateTimeEntry(o: string, _u: string, id: string, upd: Record<string, any>) { await this.db.update(timeEntries).set({ ...dtoToRow(upd, NUM, STRIP), updatedAt: new Date() } as any).where(and(eq(timeEntries.orgId, o), eq(timeEntries.timeEntryId, id))); }
    async deleteTimeEntry(o: string, _u: string, id: string) { await this.db.delete(timeEntries).where(and(eq(timeEntries.orgId, o), eq(timeEntries.timeEntryId, id))); }
    async upsertTimeEntry(te: TimeEntry) { const row = { ...dtoToRow(te as Record<string, any>, NUM, STRIP), ownerId: ownerFromSk(te as any) }; await this.db.insert(timeEntries).values(row as any).onConflictDoUpdate({ target: timeEntries.timeEntryId, set: row as any, setWhere: sql`${timeEntries.updatedAt} <= excluded.updated_at` }); }
}
