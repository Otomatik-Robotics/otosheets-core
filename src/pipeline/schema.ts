import { z } from 'zod';

export const PipelineSourceSchema = z.object({
    id: z.string(),
    sourceType: z.string(),
    channelId: z.string().nullish(),
    channelName: z.string().nullish(),
    addedAt: z.string(),
});
export type PipelineSource = z.infer<typeof PipelineSourceSchema>;

/**
 * Voice-calling config for a pipeline. When enabled, a "CALLING" stage sits between
 * NEW and CONTACTED and acts as the visible dial queue. Capabilities are the toggles
 * for what the voice agent may do mid-call (e.g. bookings, pricing) — one config per
 * pipeline, no per-lead overrides.
 */
export const PipelineVoiceConfigSchema = z.object({
    enabled: z.boolean().default(false),
    /** Assigned voice agent — owns the system prompt, tools and outbound number */
    agentId: z.string().nullish(),
    /** Cancel window (seconds) before a queued call dials. 0–900 (SQS DelaySeconds ceiling). */
    dialCooldownSeconds: z.number().int().min(0).max(900).nullish(),
    /**
     * Auto-retry for unanswered (NO_ANSWER) calls. Absent or `enabled:false` means
     * no retry — the lead drops back to NEW on the first no-answer. When enabled, the
     * card stays in CALLING and the retry sweep re-dials up to `attemptsPerDay` times
     * a day, `minHoursBetween` hours apart, across up to `maxDays` business days
     * (within ACMA calling hours), then drops to NEW if still unreached.
     */
    retry: z.object({
        enabled: z.boolean().default(false),
        attemptsPerDay: z.number().int().min(1).max(10),
        minHoursBetween: z.number().min(0.25).max(24),
        maxDays: z.number().int().min(1).max(14),
    }).nullish(),
    /** @deprecated superseded by the agent's tools; kept for back-compat reads */
    capabilities: z.record(z.string(), z.boolean()).default({}),
    /** @deprecated superseded by the agent's systemPrompt */
    scriptPrompt: z.string().nullish(),
    /** @deprecated superseded by the agent's allocated number */
    phoneNumberId: z.string().nullish(),
});
export type PipelineVoiceConfig = z.infer<typeof PipelineVoiceConfigSchema>;

export const PipelineBaseSchema = z.object({
    pipelineId: z.string(),
    name: z.string(),
    description: z.string().nullish(),
    stages: z.array(z.string()),
    isDefault: z.boolean().default(false),
    sources: z.array(PipelineSourceSchema).default([]),
    voiceConfig: PipelineVoiceConfigSchema.nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type PipelineBase = z.infer<typeof PipelineBaseSchema>;

export const PipelineStoredSchema = PipelineBaseSchema.extend({
    orgId: z.string(),
    createdBy: z.string(),
});
export type Pipeline = z.infer<typeof PipelineStoredSchema>;

export const PipelineCreateRequestSchema = z.object({
    name: z.string(),
    description: z.string().nullish(),
    stages: z.array(z.string()),
    isDefault: z.boolean().optional(),
    sources: z.array(PipelineSourceSchema).optional(),
});
export type PipelineCreateRequest = z.infer<typeof PipelineCreateRequestSchema>;
