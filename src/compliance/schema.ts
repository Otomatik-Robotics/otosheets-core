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
    expiryDate: z.string().nullish(), // YYYY-MM-DD — credential/licence expiry for renewal reminders
    renewalNotifiedAt: z.string().nullish(),
    renewalNotificationCount: z.number().nullish(),
    extracted: z.any().nullish(), // AI-extracted document metadata (documentType, holderName, documentNumber, issueDate, expiryDate, confidence)
    status: z.string().default('PENDING'),
    formData: z.any().nullish(),
    fileKey: z.string().nullish(),
    fileName: z.string().nullish(),
    submittedAt: z.string().nullish(),
    acknowledgedAt: z.string().nullish(),
    reviewedAt: z.string().nullish(),
    reviewedBy: z.string().nullish(),
    reviewNote: z.string().nullish(),
    lastReminderAt: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type ComplianceTask = z.infer<typeof ComplianceTaskStoredSchema>;

export const ComplianceSettingsStoredSchema = z.object({
    orgId: z.string(),
    sk: z.literal('COMPLIANCE_SETTINGS'),
    renewalDaysBefore: z.number().default(30), // start notifying this many days before expiry
    renewalFrequencyDays: z.number().default(7), // repeat notification every N days
    notifyByEmail: z.boolean().default(true),
    checkTypes: z.array(z.string()).nullish(), // mandatory check names required of every member
    updatedAt: z.string(),
    updatedBy: z.string().nullish(),
});
export type ComplianceSettings = z.infer<typeof ComplianceSettingsStoredSchema>;

/**
 * A mandatory compliance check held by an org member (e.g. Police Check,
 * First Aid, Worker Screening). Status is derived at read time from the
 * expiry date — it is intentionally not stored.
 */
export const MemberCertificationStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(), // CERT#{membershipId}#{certKey}
    membershipId: z.string(),
    certKey: z.string(), // slug of the check name, e.g. 'police-check'
    name: z.string(), // display name, e.g. 'Police Check'
    expiry: z.string().nullish(), // YYYY-MM-DD; absent = pending/not yet provided
    fileKey: z.string().nullish(),
    fileName: z.string().nullish(),
    extracted: z.any().nullish(), // AI-extracted document metadata
    notes: z.string().nullish(),
    renewalNotifiedAt: z.string().nullish(),
    renewalNotificationCount: z.number().nullish(),
    updatedBy: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type MemberCertification = z.infer<typeof MemberCertificationStoredSchema>;
