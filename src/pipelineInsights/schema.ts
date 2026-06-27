import { z } from 'zod';

/**
 * Precomputed pipeline insights. A snapshot is computed out-of-band (a 12-hour
 * cron) per org+pipeline and stored whole, so the Insights page reads a single
 * item instead of crunching the whole leads table on every request.
 *
 * PK: orgId, SK: pipelineId.
 */

export const InsightCardSchema = z.object({
    type: z.string(),
    title: z.string(),
    description: z.string(),
    /** high | medium | low | info — drives the card's accent colour */
    severity: z.string(),
    value: z.number().nullish(),
    metadata: z.record(z.string(), z.unknown()).nullish(),
});
export type InsightCard = z.infer<typeof InsightCardSchema>;

export const PipelineKpiSchema = z.object({
    activeLeads: z.number(),
    pipelineValue: z.number(),
    wonValue: z.number(),
    /** 0..1 — won / (won + lost) */
    winRate: z.number(),
    avgDealSize: z.number(),
    newLeads7d: z.number(),
    newLeads30d: z.number(),
    /** Change vs the prior equal-length window (absolute), for trend arrows */
    pipelineValueDelta: z.number().nullish(),
    newLeadsDelta: z.number().nullish(),
});
export type PipelineKpi = z.infer<typeof PipelineKpiSchema>;

export const FunnelStageSchema = z.object({
    stage: z.string(),
    count: z.number(),
    value: z.number(),
    /** Share of leads that ever reached this stage (0..1) */
    reachedRate: z.number().nullish(),
});
export type FunnelStage = z.infer<typeof FunnelStageSchema>;

export const SourcePerformanceSchema = z.object({
    source: z.string(),
    leads: z.number(),
    won: z.number(),
    /** won / closed (0..1) */
    conversion: z.number(),
    value: z.number(),
});
export type SourcePerformance = z.infer<typeof SourcePerformanceSchema>;

export const VelocityStageSchema = z.object({
    stage: z.string(),
    avgDays: z.number(),
});

export const VelocitySchema = z.object({
    avgDaysToWin: z.number().nullish(),
    avgDaysInPipeline: z.number().nullish(),
    perStage: z.array(VelocityStageSchema).default([]),
});
export type Velocity = z.infer<typeof VelocitySchema>;

export const TrendPointSchema = z.object({
    weekStart: z.string(),
    created: z.number(),
    won: z.number(),
});
export type TrendPoint = z.infer<typeof TrendPointSchema>;

export const ServiceTypeStatSchema = z.object({
    serviceType: z.string(),
    count: z.number(),
    value: z.number(),
});
export type ServiceTypeStat = z.infer<typeof ServiceTypeStatSchema>;

export const PipelineInsightsSnapshotSchema = z.object({
    orgId: z.string(),
    pipelineId: z.string(),
    pipelineName: z.string(),
    /** ISO timestamp of when this snapshot was computed */
    generatedAt: z.string(),
    /** Total leads considered (across all stages) */
    leadCount: z.number(),
    /** AI-written narrative summary; absent until the cron's LLM pass runs */
    narrative: z.string().nullish(),
    kpis: PipelineKpiSchema,
    funnel: z.array(FunnelStageSchema).default([]),
    sources: z.array(SourcePerformanceSchema).default([]),
    velocity: VelocitySchema,
    trend: z.array(TrendPointSchema).default([]),
    serviceTypes: z.array(ServiceTypeStatSchema).default([]),
    insights: z.array(InsightCardSchema).default([]),
});
export type PipelineInsightsSnapshot = z.infer<typeof PipelineInsightsSnapshotSchema>;
