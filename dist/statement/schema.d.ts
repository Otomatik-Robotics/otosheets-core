import { z } from 'zod';
export declare const StatementBaseSchema: z.ZodObject<{
    statementId: z.ZodString;
    fy: z.ZodString;
    fileName: z.ZodString;
    fileType: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    s3Key: z.ZodString;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    createdAt: string;
    s3Key: string;
    statementId: string;
    fy: string;
    fileName: string;
    fileType?: string | null | undefined;
}, {
    createdAt: string;
    s3Key: string;
    statementId: string;
    fy: string;
    fileName: string;
    fileType?: string | null | undefined;
}>;
export type StatementBase = z.infer<typeof StatementBaseSchema>;
export declare const StatementStoredSchema: z.ZodObject<{
    statementId: z.ZodString;
    fy: z.ZodString;
    fileName: z.ZodString;
    fileType: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    s3Key: z.ZodString;
    createdAt: z.ZodString;
} & {
    userId: z.ZodString;
    sk: z.ZodString;
    organizationId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    userId: string;
    createdAt: string;
    sk: string;
    s3Key: string;
    statementId: string;
    fy: string;
    fileName: string;
    fileType?: string | null | undefined;
    organizationId?: string | null | undefined;
}, {
    userId: string;
    createdAt: string;
    sk: string;
    s3Key: string;
    statementId: string;
    fy: string;
    fileName: string;
    fileType?: string | null | undefined;
    organizationId?: string | null | undefined;
}>;
export type Statement = z.infer<typeof StatementStoredSchema>;
export declare const StatementCreateRequestSchema: z.ZodObject<{
    fy: z.ZodString;
    fileName: z.ZodString;
    fileType: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    s3Key: z.ZodString;
    organizationId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    s3Key: string;
    fy: string;
    fileName: string;
    fileType?: string | null | undefined;
    organizationId?: string | null | undefined;
}, {
    s3Key: string;
    fy: string;
    fileName: string;
    fileType?: string | null | undefined;
    organizationId?: string | null | undefined;
}>;
export type StatementCreateRequest = z.infer<typeof StatementCreateRequestSchema>;
//# sourceMappingURL=schema.d.ts.map