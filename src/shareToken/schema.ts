import { z } from 'zod';

export const ShareTokenStoredSchema = z.object({
    token: z.string(),
    userId: z.string(),
    fy: z.string(),
    label: z.string(),
    accessCount: z.number().default(0),
    expiresAt: z.string(),
    createdAt: z.string(),
    ttl: z.number().nullish(),
});
export type ShareToken = z.infer<typeof ShareTokenStoredSchema>;

export const ShareTokenCreateRequestSchema = z.object({
    fy: z.string(),
    label: z.string(),
    expiryDays: z.number().default(30),
});
export type ShareTokenCreateRequest = z.infer<typeof ShareTokenCreateRequestSchema>;
