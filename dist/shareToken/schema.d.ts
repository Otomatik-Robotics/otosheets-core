import { z } from 'zod';
export declare const ShareTokenStoredSchema: z.ZodObject<{
    token: z.ZodString;
    userId: z.ZodString;
    fy: z.ZodString;
    label: z.ZodString;
    accessCount: z.ZodDefault<z.ZodNumber>;
    expiresAt: z.ZodString;
    createdAt: z.ZodString;
    ttl: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    userId: string;
    createdAt: string;
    fy: string;
    token: string;
    label: string;
    accessCount: number;
    expiresAt: string;
    ttl?: number | null | undefined;
}, {
    userId: string;
    createdAt: string;
    fy: string;
    token: string;
    label: string;
    expiresAt: string;
    ttl?: number | null | undefined;
    accessCount?: number | undefined;
}>;
export type ShareToken = z.infer<typeof ShareTokenStoredSchema>;
export declare const ShareTokenCreateRequestSchema: z.ZodObject<{
    fy: z.ZodString;
    label: z.ZodString;
    expiryDays: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    fy: string;
    label: string;
    expiryDays: number;
}, {
    fy: string;
    label: string;
    expiryDays?: number | undefined;
}>;
export type ShareTokenCreateRequest = z.infer<typeof ShareTokenCreateRequestSchema>;
//# sourceMappingURL=schema.d.ts.map