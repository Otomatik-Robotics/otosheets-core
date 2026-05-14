import { z } from 'zod';

export const TeamStoredSchema = z.object({
    orgId: z.string(),
    teamId: z.string(),
    name: z.string(),
    memberIds: z.array(z.string()).default([]),
    createdBy: z.string().nullish(),
    createdAt: z.string(),
});
export type Team = z.infer<typeof TeamStoredSchema>;

export const TeamCreateRequestSchema = z.object({
    name: z.string(),
    memberIds: z.array(z.string()).optional(),
});
export type TeamCreateRequest = z.infer<typeof TeamCreateRequestSchema>;
