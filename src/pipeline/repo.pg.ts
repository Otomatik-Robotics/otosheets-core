import { and, eq, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { pipelines } from '../pg/schema/leadsPipelines';
import { toRow, fromRow } from '../pg/rows';
import { Pipeline } from './schema';
import type { IPipelineRepo } from './repo';

/** Pipelines have no sort key — generic toRow/fromRow suffice (jsonb arrays pass through). */
export class PipelinePgRepo implements IPipelineRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    async getPipeline(orgId: string, pipelineId: string): Promise<Pipeline | null> {
        const rows = await this.db.select().from(pipelines)
            .where(and(eq(pipelines.orgId, orgId), eq(pipelines.pipelineId, pipelineId))).limit(1);
        return rows[0] ? fromRow<Pipeline>(rows[0]) : null;
    }

    async listPipelines(orgId: string): Promise<Pipeline[]> {
        const rows = await this.db.select().from(pipelines).where(eq(pipelines.orgId, orgId));
        return rows.map((r: any) => fromRow<Pipeline>(r));
    }

    async scanAllPipelines(): Promise<Pipeline[]> {
        const rows = await this.db.select().from(pipelines);
        return rows.map((r: any) => fromRow<Pipeline>(r));
    }

    async getDefaultPipeline(orgId: string): Promise<Pipeline | null> {
        const rows = await this.db.select().from(pipelines)
            .where(and(eq(pipelines.orgId, orgId), eq(pipelines.isDefault, true))).limit(1);
        return rows[0] ? fromRow<Pipeline>(rows[0]) : null;
    }

    async createPipeline(orgId: string, pipelineId: string, data: Record<string, any>): Promise<void> {
        const now = new Date();
        await this.db.insert(pipelines).values({ sources: [], ...toRow(pipelines, data, 'pipeline'), orgId, pipelineId, createdAt: now, updatedAt: now } as any);
    }

    async updatePipeline(orgId: string, pipelineId: string, updates: Record<string, any>): Promise<void> {
        await this.db.update(pipelines)
            .set({ ...toRow(pipelines, updates, 'pipeline'), updatedAt: new Date() } as any)
            .where(and(eq(pipelines.orgId, orgId), eq(pipelines.pipelineId, pipelineId)));
    }

    async deletePipeline(orgId: string, pipelineId: string): Promise<void> {
        await this.db.delete(pipelines).where(and(eq(pipelines.orgId, orgId), eq(pipelines.pipelineId, pipelineId)));
    }

    async upsertPipeline(pipeline: Pipeline): Promise<void> {
        const row = toRow(pipelines, pipeline as Record<string, any>, 'pipeline');
        await this.db.insert(pipelines).values(row as any)
            .onConflictDoUpdate({ target: pipelines.pipelineId, set: row as any, setWhere: sql`${pipelines.updatedAt} <= excluded.updated_at` });
    }
}
