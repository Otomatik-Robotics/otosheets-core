import { z } from 'zod';

export const CompliancePlaybookStoredSchema = z.object({
    orgId: z.string(),
    sk: z.literal('PLAYBOOK'),
    tasks: z.any(),
    updatedAt: z.string(),
    updatedBy: z.string().nullish(),
});
export type CompliancePlaybook = z.infer<typeof CompliancePlaybookStoredSchema>;

export const ComplianceTaskStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(),
    taskId: z.string(),
    membershipId: z.string(),
    userId: z.string(),
    templateTaskId: z.string().nullish(),
    title: z.string(),
    category: z.string().nullish(),
    taskType: z.string(), // DOCUMENT_UPLOAD | FORM_FILL | ACKNOWLEDGEMENT | GENERAL_TASK
    isComplianceTask: z.boolean().default(true),
    description: z.string().nullish(),
    required: z.boolean().default(true),
    dueDate: z.string().nullish(),
    status: z.string().default('PENDING'),
    formData: z.any().nullish(),
    fileKey: z.string().nullish(),
    fileName: z.string().nullish(),
    submittedAt: z.string().nullish(),
    acknowledgedAt: z.string().nullish(),
    reviewedAt: z.string().nullish(),
    reviewedBy: z.string().nullish(),
    reviewNote: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type ComplianceTask = z.infer<typeof ComplianceTaskStoredSchema>;
