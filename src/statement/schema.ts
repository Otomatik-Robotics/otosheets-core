import { z } from 'zod';

export const StatementBaseSchema = z.object({
    statementId: z.string(),
    fy: z.string(),
    fileName: z.string(),
    fileType: z.string().nullish(),
    s3Key: z.string(),
    createdAt: z.string(),
});
export type StatementBase = z.infer<typeof StatementBaseSchema>;

export const StatementStoredSchema = StatementBaseSchema.extend({
    userId: z.string(),
    sk: z.string(),
    organizationId: z.string().nullish(),
});
export type Statement = z.infer<typeof StatementStoredSchema>;

export const StatementCreateRequestSchema = z.object({
    fy: z.string(),
    fileName: z.string(),
    fileType: z.string().nullish(),
    s3Key: z.string(),
    organizationId: z.string().nullish(),
});
export type StatementCreateRequest = z.infer<typeof StatementCreateRequestSchema>;
