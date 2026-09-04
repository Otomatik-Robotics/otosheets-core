import { and, eq, sql, notInArray } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { leads } from '../pg/schema/leadsPipelines';
import type { Lead } from '../lead/schema';

/**
 * Lead aggregates for the Home card: how much is waiting, and what has gone
 * quiet. Postgres-only reporting (POSTGRES_MIGRATION_PLAN.md §8) — these are
 * GROUP BY and time-window reads that DynamoDB cannot answer without a GSI per
 * question, so there is no router and no Dynamo twin.
 */

/** Stages that mean the lead is finished, not neglected. */
export const TERMINAL_STAGES = ['COMPLETE', 'LOST'];

/**
 * When a lead entered the stage it is sitting in now.
 *
 * The last `stage_history` entry is the current stage: the array is seeded at
 * creation and appended on every move. Leads predating the column fall back to
 * their creation date, which is the honest answer for one that has never moved.
 *
 * Deliberately NOT `updated_at`. Every write bumps that, so a lead edited
 * yesterday but not advanced for a month would look fresh — which is the bug
 * in the shipped "going cold" card.
 */
const IN_STAGE_SINCE = sql`COALESCE((${leads.stageHistory} -> -1 ->> 'changedAt')::timestamptz, ${leads.createdAt})`;

export interface PipelineStageCount {
    /** Null for leads that carry no pipeline; the caller folds these in. */
    pipelineId: string | null;
    count: number;
}

export interface StaleLead {
    lead: Lead;
    /** When it entered its current stage. */
    inStageSince: Date;
    /** Whole days it has sat there, so the UI can name the exact number. */
    days: number;
}

export class LeadReportingPgRepo {
    constructor(private readonly db: PgDb = getPg()) {}

    /**
     * How many leads sit in a stage, per pipeline, in one query.
     *
     * Counting client-side is not an option: the list is paginated, so a
     * group-by over a page only ever sees a page.
     */
    async countByPipeline(orgId: string, stage: string): Promise<PipelineStageCount[]> {
        const rows = await this.db
            .select({ pipelineId: leads.pipelineId, n: sql<number>`count(*)::int` })
            .from(leads)
            .where(and(eq(leads.orgId, orgId), eq(leads.stage, stage)))
            .groupBy(leads.pipelineId);
        return rows.map(r => ({ pipelineId: r.pipelineId ?? null, count: r.n ?? 0 }));
    }

    /** Leads that have not moved stage in `days`, longest-sitting first. */
    async listStale(orgId: string, days: number, limit = 200): Promise<StaleLead[]> {
        const rows = await this.db
            .select({
                row: leads,
                since: sql<string>`${IN_STAGE_SINCE}`,
                days: sql<number>`floor(extract(epoch from (now() - ${IN_STAGE_SINCE})) / 86400)::int`,
            })
            .from(leads)
            .where(and(
                eq(leads.orgId, orgId),
                notInArray(leads.stage, TERMINAL_STAGES),
                sql`${IN_STAGE_SINCE} < now() - make_interval(days => ${days})`,
            ))
            .orderBy(sql`${IN_STAGE_SINCE} asc`)
            .limit(limit);
        return rows.map(r => ({
            lead: r.row as unknown as Lead,
            inStageSince: new Date(r.since as unknown as string),
            days: r.days ?? 0,
        }));
    }
}
