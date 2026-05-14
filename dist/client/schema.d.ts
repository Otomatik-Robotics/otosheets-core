import { z } from 'zod';
export declare const ClientStoredSchema: z.ZodObject<{
    orgId: z.ZodString;
    clientId: z.ZodString;
    createdBy: z.ZodString;
    name: z.ZodString;
    email: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    abn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    contactPerson: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    convertedFromLeadId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    convertedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    createdAt: string;
    updatedAt: string;
    orgId: string;
    createdBy: string;
    clientId: string;
    email?: string | null | undefined;
    abn?: string | null | undefined;
    address?: string | null | undefined;
    contactPerson?: string | null | undefined;
    convertedFromLeadId?: string | null | undefined;
    convertedAt?: string | null | undefined;
}, {
    name: string;
    createdAt: string;
    updatedAt: string;
    orgId: string;
    createdBy: string;
    clientId: string;
    email?: string | null | undefined;
    abn?: string | null | undefined;
    address?: string | null | undefined;
    contactPerson?: string | null | undefined;
    convertedFromLeadId?: string | null | undefined;
    convertedAt?: string | null | undefined;
}>;
export type Client = z.infer<typeof ClientStoredSchema>;
export declare const ClientCreateRequestSchema: z.ZodObject<{
    name: z.ZodString;
    email: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    abn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    contactPerson: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    email?: string | null | undefined;
    abn?: string | null | undefined;
    address?: string | null | undefined;
    contactPerson?: string | null | undefined;
}, {
    name: string;
    email?: string | null | undefined;
    abn?: string | null | undefined;
    address?: string | null | undefined;
    contactPerson?: string | null | undefined;
}>;
export type ClientCreateRequest = z.infer<typeof ClientCreateRequestSchema>;
//# sourceMappingURL=schema.d.ts.map