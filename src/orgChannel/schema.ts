import { z } from 'zod';

export const OrgChannelStoredSchema = z.object({
    orgId: z.string(),
    channelId: z.string(),
    name: z.string(),
    type: z.string(),
    teamId: z.string().nullish(),
    memberIds: z.array(z.string()).nullish(),
    lastRead: z.any().nullish(),
    createdBy: z.string().nullish(),
    createdAt: z.string(),
});
export type OrgChannel = z.infer<typeof OrgChannelStoredSchema>;

export const OrgChannelCreateRequestSchema = z.object({
    name: z.string(),
    type: z.string(),
    teamId: z.string().nullish(),
    memberIds: z.array(z.string()).nullish(),
});
export type OrgChannelCreateRequest = z.infer<typeof OrgChannelCreateRequestSchema>;
