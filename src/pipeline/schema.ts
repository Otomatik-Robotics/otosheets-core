import { z } from 'zod';

export const PipelineSourceSchema = z.object({
    id: z.string(),
    sourceType: z.string(),
    channelId: z.string().nullish(),
    channelName: z.string().nullish(),
    addedAt: z.string(),
});
export type PipelineSource = z.infer<typeof PipelineSourceSchema>;

export const PipelineStoredSchema = z.object({
    orgId: z.string(),
    pipelineId: z.string(),
    createdBy: z.string(),
    name: z.string(),
    description: z.string().nullish(),
    stages: z.array(z.string()),
    isDefault: z.boolean().default(false),
    sources: z.array(PipelineSourceSchema).default([]),
    createdAt: z.string(),
    updatedAt: z.string(),
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
