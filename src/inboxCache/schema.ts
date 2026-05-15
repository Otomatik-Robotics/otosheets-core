import { z } from 'zod';

export const InboxCacheStoredSchema = z.object({
    userId: z.string(),
    gmailId: z.string(),
    threadId: z.string(),
    from: z.string(),
    subject: z.string(),
    snippet: z.string(),
    date: z.string(),
    category: z.string().nullish(),
    clientId: z.string().nullish(),
    clientName: z.string().nullish(),
    cachedAt: z.string(),
    ttl: z.number().nullish(),
});
export type InboxCache = z.infer<typeof InboxCacheStoredSchema>;

export const InboxCacheCreateRequestSchema = z.object({
    gmailId: z.string(),
    threadId: z.string(),
    from: z.string(),
    subject: z.string(),
    snippet: z.string(),
    date: z.string(),
    category: z.string().nullish(),
    clientId: z.string().nullish(),
    clientName: z.string().nullish(),
});
export type InboxCacheCreateRequest = z.infer<typeof InboxCacheCreateRequestSchema>;
