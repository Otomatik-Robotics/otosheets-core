import { z } from 'zod';

export const ComplianceTaskStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(),
    taskId: z.string(),
    membershipId: z.string(),
    userId: z.string(),
    templateTaskId: z.string().nullish(),
    checklistId: z.string().nullish(), // source checklist this task was instantiated from
    itemId: z.string().nullish(), // source checklist item id
    title: z.string(),
    category: z.string().nullish(),
    taskType: z.string(), // DOCUMENT_UPLOAD | FORM_FILL | ACKNOWLEDGEMENT | SIGNATURE | GENERAL_TASK
    isComplianceTask: z.boolean().default(true),
    description: z.string().nullish(),
    externalLink: z.string().nullish(), // optional resource link shown on the item
    acknowledgementText: z.string().nullish(), // shown for ACKNOWLEDGEMENT items
    formFields: z.any().nullish(), // field definitions for FORM_FILL items (copied from the checklist item)
    required: z.boolean().default(true),
    hasExpiry: z.boolean().nullish(), // credential item — carries an expiry date + renewals
    requiresSignature: z.boolean().nullish(), // item must be signed to complete
    signatureData: z.string().nullish(), // base64 PNG data URL captured at completion
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
    defaultAutoRenew: z.boolean().default(false), // org-wide default: auto-reopen expired credential items
    checkTypes: z.array(z.string()).nullish(), // legacy: mandatory check names (migrated to checklists)
    updatedAt: z.string(),
    updatedBy: z.string().nullish(),
});
export type ComplianceSettings = z.infer<typeof ComplianceSettingsStoredSchema>;

// ─── Compliance checklists (named, assignable templates) ──────────────

/** A single actionable item within a checklist. */
export const ComplianceChecklistItemSchema = z.object({
    itemId: z.string(),
    title: z.string(),
    description: z.string().nullish(),
    category: z.string().nullish(),
    itemType: z.enum(['DOCUMENT_UPLOAD', 'ACKNOWLEDGEMENT', 'SIGNATURE', 'FORM_FILL']),
    required: z.boolean().default(true),
    hasExpiry: z.boolean().default(false), // credential item — carries an expiry date + renewals
    externalLink: z.string().nullish(),
    acknowledgementText: z.string().nullish(),
    formFields: z.array(z.object({
        name: z.string(),
        label: z.string(),
        type: z.string(),
        required: z.boolean().default(false),
    })).nullish(),
    dueDaysAfterAssign: z.number().nullish(),
});
export type ComplianceChecklistItem = z.infer<typeof ComplianceChecklistItemSchema>;

/** Who a checklist is assigned to. Resolved to members at assign time. */
export const ChecklistAssignmentSchema = z.object({
    teamIds: z.array(z.string()).default([]),
    roles: z.array(z.string()).default([]), // OWNER | ADMIN | MEMBER | CONTRACTOR ...
    membershipIds: z.array(z.string()).default([]),
});
export type ChecklistAssignment = z.infer<typeof ChecklistAssignmentSchema>;

export const ComplianceChecklistStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(), // CHECKLIST#{checklistId}
    checklistId: z.string(),
    name: z.string(),
    description: z.string().nullish(),
    category: z.string().nullish(),
    items: z.array(ComplianceChecklistItemSchema).default([]),
    assignment: ChecklistAssignmentSchema.default({ teamIds: [], roles: [], membershipIds: [] }),
    autoAssignOnJoin: z.boolean().default(false), // instantiate to new members matching assignment
    autoRenew: z.boolean().default(false), // auto-reopen expired credential items in this checklist
    createdAt: z.string(),
    createdBy: z.string().nullish(),
    updatedAt: z.string(),
    updatedBy: z.string().nullish(),
});
export type ComplianceChecklist = z.infer<typeof ComplianceChecklistStoredSchema>;

