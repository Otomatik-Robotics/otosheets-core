import { z } from 'zod';
export declare const InboxCacheStoredSchema: z.ZodObject<{
    userId: z.ZodString;
    gmailId: z.ZodString;
    threadId: z.ZodString;
    from: z.ZodString;
    subject: z.ZodString;
    snippet: z.ZodString;
    date: z.ZodString;
    category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    clientId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    clientName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    cachedAt: z.ZodString;
    ttl: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    subject: string;
    userId: string;
    date: string;
    gmailId: string;
    threadId: string;
    from: string;
    snippet: string;
    cachedAt: string;
    clientId?: string | null | undefined;
    clientName?: string | null | undefined;
    category?: string | null | undefined;
    ttl?: number | null | undefined;
}, {
    subject: string;
    userId: string;
    date: string;
    gmailId: string;
    threadId: string;
    from: string;
    snippet: string;
    cachedAt: string;
    clientId?: string | null | undefined;
    clientName?: string | null | undefined;
    category?: string | null | undefined;
    ttl?: number | null | undefined;
}>;
export type InboxCache = z.infer<typeof InboxCacheStoredSchema>;
export declare const InboxCacheCreateRequestSchema: z.ZodObject<{
    gmailId: z.ZodString;
    threadId: z.ZodString;
    from: z.ZodString;
    subject: z.ZodString;
    snippet: z.ZodString;
    date: z.ZodString;
    category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    clientId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    clientName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    subject: string;
    date: string;
    gmailId: string;
    threadId: string;
    from: string;
    snippet: string;
    clientId?: string | null | undefined;
    clientName?: string | null | undefined;
    category?: string | null | undefined;
}, {
    subject: string;
    date: string;
    gmailId: string;
    threadId: string;
    from: string;
    snippet: string;
    clientId?: string | null | undefined;
    clientName?: string | null | undefined;
    category?: string | null | undefined;
}>;
export type InboxCacheCreateRequest = z.infer<typeof InboxCacheCreateRequestSchema>;
//# sourceMappingURL=schema.d.ts.map