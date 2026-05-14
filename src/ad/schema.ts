import { z } from 'zod';

export const AdBaseSchema = z.object({
    adId: z.string(),
    status: z.string().default('DRAFT'),
    mediaKeys: z.array(z.string()).nullish(),
    mediaAnalyses: z.any().nullish(),
    adCopy: z.any().nullish(),
    selectedCopy: z.number().nullish(),
    storyboard: z.any().nullish(),
    brollScenes: z.any().nullish(),
    creativeBrief: z.any().nullish(),
    renderedVideoKey: z.string().nullish(),
    previewVideoKey: z.string().nullish(),
    targetAudience: z.string().nullish(),
    location: z.string().nullish(),
    headline: z.string().nullish(),
    primaryText: z.string().nullish(),
    callToAction: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type AdBase = z.infer<typeof AdBaseSchema>;

export const AdStoredSchema = AdBaseSchema.extend({
    orgId: z.string(),
    sk: z.string(),
    createdBy: z.string(),
});
export type Ad = z.infer<typeof AdStoredSchema>;

export const AdCreateRequestSchema = z.object({
    mediaKeys: z.array(z.string()).nullish(),
    targetAudience: z.string().nullish(),
    location: z.string().nullish(),
});
export type AdCreateRequest = z.infer<typeof AdCreateRequestSchema>;
