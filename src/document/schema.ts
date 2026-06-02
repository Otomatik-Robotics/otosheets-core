import { z } from 'zod';

export const DocumentStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(),                       // DOC#{documentId}
    documentId: z.string(),
    name: z.string(),                     // Display name (editable)
    description: z.string().default(''),
    category: z.string().default('general'), // contract, proposal, letter, invoice, report, general
    s3Key: z.string(),                    // PDF location in S3
    sizeBytes: z.number().optional(),
    sourceTemplateId: z.string().optional(),  // template that generated this (if any)
    sourceTemplateName: z.string().optional(),
    variables: z.record(z.string()).optional(), // variables used during generation
    createdBy: z.string(),
    createdAt: z.string(),
    updatedAt: z.string().optional(),
});
export type DocumentStored = z.infer<typeof DocumentStoredSchema>;
