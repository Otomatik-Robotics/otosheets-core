import { and, eq, sql, desc, lt, or, gte, notInArray } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { leads } from '../pg/schema/leadsPipelines';
import { orgStageKey } from '../keys';
import { keysetFromStartKey, keysetStartKey } from '../pg/cursor';
import { dtoToRow, rowToDto, ownerFromSk } from '../pg/billingRows';
import { PaginatedResult } from '../types';
import { Lead } from './schema';
import type { ILeadRepo } from './repo';

const NUMERIC_KEYS = ['quotedAmount'];
const PG_ONLY = ['ownerId'];
const STRIP = ['sk']; // derived on read; owner_id carries ownership

function toDto(row: any): Lead {
    const dto = rowToDto<any>(row, NUMERIC_KEYS, PG_ONLY);
    dto.sk = `${row.ownerId}#${row.leadId}`;
    return dto as Lead;
}

export class LeadPgRepo implements ILeadRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    async getLead(orgId: string, _userId: string, leadId: string): Promise<Lead | null> {
        const rows = await this.db.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.leadId, leadId))).limit(1);
        return rows[0] ? toDto(rows[0]) : null;
    }
    async findLeadByIdInOrg(orgId: string, leadId: string): Promise<{ lead: Lead; ownerId: string } | null> {
        const rows = await this.db.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.leadId, leadId))).limit(1);
        if (!rows[0]) return null;
        return { lead: toDto(rows[0]), ownerId: (rows[0] as any).ownerId };
    }
    async listUserLeads(orgId: string, userId: string): Promise<Lead[]> {
        const rows = await this.db.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.ownerId, userId)));
        return rows.map(toDto);
    }
    async listAllOrgLeads(orgId: string): Promise<Lead[]> {
        const rows = await this.db.select().from(leads).where(eq(leads.orgId, orgId));
        return rows.map(toDto);
    }
    async listOrgLeadsPaginated(params: { orgId: string; businessProfileId?: string; limit?: number; exclusiveStartKey?: Record<string, any>; stage?: string; source?: string; search?: string; }): Promise<PaginatedResult<Lead>> {
        const { orgId, businessProfileId, limit = 20, exclusiveStartKey, stage, source, search } = params;
        const conds: any[] = [eq(leads.orgId, orgId)];
        if (businessProfileId) conds.push(eq(leads.businessProfileId, businessProfileId));
        if (stage) conds.push(eq(leads.stage, stage));
        if (source) conds.push(eq(leads.source, source));
        if (search) { const like = `%${search}%`; conds.push(or(sql`${leads.clientName} ILIKE ${like}`, sql`${leads.clientEmail} ILIKE ${like}`, sql`${leads.suburb} ILIKE ${like}`)); }
        const cursor = keysetFromStartKey(exclusiveStartKey, 'leadId');
        if (cursor) conds.push(or(lt(leads.createdAt, new Date(cursor.createdAt)), and(eq(leads.createdAt, new Date(cursor.createdAt)), lt(leads.leadId, cursor.id))));
        const rows = await this.db.select().from(leads).where(and(...conds)).orderBy(desc(leads.createdAt), desc(leads.leadId)).limit(limit);
        const last = rows[rows.length - 1] as any;
        const lastEvaluatedKey = rows.length === limit && last ? keysetStartKey({ createdAt: (last.createdAt as Date).toISOString(), id: last.leadId }) : undefined;
        return { items: rows.map(toDto), lastEvaluatedKey };
    }
    async findActiveLeadBySenderId(orgId: string, senderId: string): Promise<Lead | null> {
        const rows = await this.db.select().from(leads)
            .where(and(eq(leads.orgId, orgId), eq(leads.senderId, senderId), notInArray(leads.stage, ['COMPLETE', 'LOST'])))
            .orderBy(desc(leads.createdAt)).limit(1);
        return rows[0] ? toDto(rows[0]) : null;
    }
    async countOrgLeads(orgId: string): Promise<number> {
        const r = await this.db.select({ n: sql<number>`count(*)::int` }).from(leads).where(eq(leads.orgId, orgId));
        return r[0]?.n ?? 0;
    }
    async listRecentLeads(orgId: string, since: string): Promise<Lead[]> {
        const rows = await this.db.select().from(leads).where(and(eq(leads.orgId, orgId), gte(leads.createdAt, new Date(since)))).orderBy(desc(leads.createdAt));
        return rows.map(toDto);
    }
    async findLeadsByPipelineId(orgId: string, pipelineId: string): Promise<Lead[]> {
        const rows = await this.db.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.pipelineId, pipelineId)));
        return rows.map(toDto);
    }
    async listLeadsByStage(orgId: string, stage: string): Promise<Lead[]> {
        const rows = await this.db.select().from(leads).where(eq(leads.orgStage, orgStageKey(orgId, stage)));
        return rows.map(toDto);
    }

    async createLead(orgId: string, userId: string, leadId: string, data: Record<string, any>): Promise<void> {
        const now = new Date();
        const stage = data.stage ?? 'NEW';
        const row = {
            ...dtoToRow(data, NUMERIC_KEYS, STRIP),
            orgId, leadId, ownerId: userId, createdBy: userId, stage,
            orgStage: orgStageKey(orgId, stage),
            stageHistory: data.stageHistory ?? [{ id: leadId, stage, changedBy: userId, changedAt: now.toISOString() }],
            createdAt: now, updatedAt: now,
        };
        await this.db.insert(leads).values(row as any);
    }
    async updateLead(orgId: string, _userId: string, leadId: string, updates: Record<string, any>): Promise<void> {
        const set: Record<string, any> = { ...dtoToRow(updates, NUMERIC_KEYS, STRIP), updatedAt: new Date() };
        if (updates.stage) set.orgStage = orgStageKey(orgId, updates.stage);
        await this.db.update(leads).set(set as any).where(and(eq(leads.orgId, orgId), eq(leads.leadId, leadId)));
    }
    async deleteLead(orgId: string, _userId: string, leadId: string): Promise<void> {
        await this.db.delete(leads).where(and(eq(leads.orgId, orgId), eq(leads.leadId, leadId)));
    }
    async upsertLead(lead: Lead): Promise<void> {
        const row = { ...dtoToRow(lead as Record<string, any>, NUMERIC_KEYS, STRIP), ownerId: ownerFromSk(lead as any) };
        await this.db.insert(leads).values(row as any)
            .onConflictDoUpdate({ target: leads.leadId, set: row as any, setWhere: sql`${leads.updatedAt} <= excluded.updated_at` });
    }
}
