"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComplianceTaskStoredSchema = exports.CompliancePlaybookStoredSchema = void 0;
const zod_1 = require("zod");
exports.CompliancePlaybookStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    sk: zod_1.z.literal('PLAYBOOK'),
    tasks: zod_1.z.any(),
    updatedAt: zod_1.z.string(),
    updatedBy: zod_1.z.string().nullish(),
});
exports.ComplianceTaskStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    sk: zod_1.z.string(),
    taskId: zod_1.z.string(),
    membershipId: zod_1.z.string(),
    userId: zod_1.z.string(),
    templateTaskId: zod_1.z.string().nullish(),
    title: zod_1.z.string(),
    category: zod_1.z.string().nullish(),
    taskType: zod_1.z.string(), // DOCUMENT_UPLOAD | FORM_FILL | ACKNOWLEDGEMENT | GENERAL_TASK
    isComplianceTask: zod_1.z.boolean().default(true),
    description: zod_1.z.string().nullish(),
    required: zod_1.z.boolean().default(true),
    dueDate: zod_1.z.string().nullish(),
    status: zod_1.z.string().default('PENDING'),
    formData: zod_1.z.any().nullish(),
    fileKey: zod_1.z.string().nullish(),
    fileName: zod_1.z.string().nullish(),
    submittedAt: zod_1.z.string().nullish(),
    acknowledgedAt: zod_1.z.string().nullish(),
    reviewedAt: zod_1.z.string().nullish(),
    reviewedBy: zod_1.z.string().nullish(),
    reviewNote: zod_1.z.string().nullish(),
    lastReminderAt: zod_1.z.string().nullish(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
//# sourceMappingURL=schema.js.map