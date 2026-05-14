import { z } from 'zod';

export const StatementStoredSchema = z.object({
    userId: z.string(),
    sk: z.string(),
    statementId: z.string(),
    organizationId: z.string().nullish(),
    fy: z.string(),
    fileName: z.string(),
    fileType: z.string().nullish(),
    s3Key: z.string(),
    createdAt: z.string(),
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
