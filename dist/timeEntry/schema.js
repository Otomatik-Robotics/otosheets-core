"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimeEntryCreateRequestSchema = exports.TimeEntryStoredSchema = void 0;
const zod_1 = require("zod");
exports.TimeEntryStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    sk: zod_1.z.string(),
    timeEntryId: zod_1.z.string(),
    createdBy: zod_1.z.string(),
    clientId: zod_1.z.string().nullish(),
    jobId: zod_1.z.string().nullish(),
    date: zod_1.z.string(),
    startTime: zod_1.z.string().nullish(),
    endTime: zod_1.z.string().nullish(),
    durationMinutes: zod_1.z.number(),
    description: zod_1.z.string(),
    project: zod_1.z.string().nullish(),
    billable: zod_1.z.boolean().default(true),
    invoicedAt: zod_1.z.string().nullish(),
    invoiceId: zod_1.z.string().nullish(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
exports.TimeEntryCreateRequestSchema = zod_1.z.object({
    clientId: zod_1.z.string().nullish(),
    jobId: zod_1.z.string().nullish(),
    date: zod_1.z.string(),
    startTime: zod_1.z.string().nullish(),
    endTime: zod_1.z.string().nullish(),
    durationMinutes: zod_1.z.number(),
    description: zod_1.z.string(),
    project: zod_1.z.string().nullish(),
    billable: zod_1.z.boolean().optional(),
});
//# sourceMappingURL=schema.js.map