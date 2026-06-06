"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimeOffCreateRequestSchema = exports.TimeOffStoredSchema = void 0;
const zod_1 = require("zod");
exports.TimeOffStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    sk: zod_1.z.string(),
    timeOffId: zod_1.z.string(),
    memberId: zod_1.z.string(),
    startDate: zod_1.z.string(),
    endDate: zod_1.z.string(),
    allDay: zod_1.z.boolean().default(true),
    startTime: zod_1.z.string().nullish(),
    endTime: zod_1.z.string().nullish(),
    reason: zod_1.z.enum(['holiday', 'sick', 'personal', 'other']),
    notes: zod_1.z.string().nullish(),
    approved: zod_1.z.boolean().default(false),
    approvedBy: zod_1.z.string().nullish(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
exports.TimeOffCreateRequestSchema = zod_1.z.object({
    startDate: zod_1.z.string(),
    endDate: zod_1.z.string(),
    allDay: zod_1.z.boolean().default(true),
    startTime: zod_1.z.string().nullish(),
    endTime: zod_1.z.string().nullish(),
    reason: zod_1.z.enum(['holiday', 'sick', 'personal', 'other']),
    notes: zod_1.z.string().nullish(),
    approved: zod_1.z.boolean().default(false),
});
//# sourceMappingURL=schema.js.map