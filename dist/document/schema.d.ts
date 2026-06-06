import { z } from 'zod';
export declare const DocumentStoredSchema: z.ZodObject<{
    orgId: z.ZodString;
    sk: z.ZodString;
    documentId: z.ZodString;
    name: z.ZodString;
    description: z.ZodDefault<z.ZodString>;
    category: z.ZodDefault<z.ZodString>;
    s3Key: z.ZodString;
    sizeBytes: z.ZodOptional<z.ZodNumber>;
    sourceTemplateId: z.ZodOptional<z.ZodString>;
    sourceTemplateName: z.ZodOptional<z.ZodString>;
    variables: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    createdBy: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    createdAt: string;
    orgId: string;
    createdBy: string;
    description: string;
    sk: string;
    s3Key: string;
    category: string;
    documentId: string;
    updatedAt?: string | undefined;
    sizeBytes?: number | undefined;
    sourceTemplateId?: string | undefined;
    sourceTemplateName?: string | undefined;
    variables?: Record<string, string> | undefined;
}, {
    name: string;
    createdAt: string;
    orgId: string;
    createdBy: string;
    sk: string;
    s3Key: string;
    documentId: string;
    updatedAt?: string | undefined;
    description?: string | undefined;
    category?: string | undefined;
    sizeBytes?: number | undefined;
    sourceTemplateId?: string | undefined;
    sourceTemplateName?: string | undefined;
    variables?: Record<string, string> | undefined;
}>;
export type DocumentStored = z.infer<typeof DocumentStoredSchema>;
//# sourceMappingURL=schema.d.ts.map