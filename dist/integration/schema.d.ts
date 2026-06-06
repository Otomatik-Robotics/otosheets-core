import { z } from 'zod';
export declare const IntegrationStoredSchema: z.ZodObject<{
    ownerId: z.ZodString;
    provider: z.ZodString;
    ownerType: z.ZodEnum<["personal", "org"]>;
    scope: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    credentials: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
    config: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
    syncSettings: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
    connectedBy: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    createdAt: string;
    updatedAt: string;
    ownerId: string;
    provider: string;
    ownerType: "personal" | "org";
    credentials?: any;
    scope?: string | null | undefined;
    config?: any;
    syncSettings?: any;
    connectedBy?: string | null | undefined;
}, {
    createdAt: string;
    updatedAt: string;
    ownerId: string;
    provider: string;
    ownerType: "personal" | "org";
    credentials?: any;
    scope?: string | null | undefined;
    config?: any;
    syncSettings?: any;
    connectedBy?: string | null | undefined;
}>;
export type Integration = z.infer<typeof IntegrationStoredSchema>;
//# sourceMappingURL=schema.d.ts.map