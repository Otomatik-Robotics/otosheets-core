"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AvailabilityRuleCreateRequestSchema = exports.AvailabilityRuleStoredSchema = void 0;
const zod_1 = require("zod");
exports.AvailabilityRuleStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    sk: zod_1.z.string(),
    ruleId: zod_1.z.string(),
    memberId: zod_1.z.string(),
    dayOfWeek: zod_1.z.number().min(0).max(6).nullish(),
    startTime: zod_1.z.string(),
    endTime: zod_1.z.string(),
    effectiveFrom: zod_1.z.string(),
    effectiveTo: zod_1.z.string().nullish(),
    recurrence: zod_1.z.enum(['weekly', 'fortnightly', 'custom']),
    customIntervalDays: zod_1.z.number().nullish(),
    isAvailable: zod_1.z.boolean().default(true),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
exports.AvailabilityRuleCreateRequestSchema = zod_1.z.object({
    dayOfWeek: zod_1.z.number().min(0).max(6).nullish(),
    startTime: zod_1.z.string(),
    endTime: zod_1.z.string(),
    effectiveFrom: zod_1.z.string(),
    effectiveTo: zod_1.z.string().nullish(),
    recurrence: zod_1.z.enum(['weekly', 'fortnightly', 'custom']).default('weekly'),
    customIntervalDays: zod_1.z.number().nullish(),
    isAvailable: zod_1.z.boolean().default(true),
});
//# sourceMappingURL=schema.js.map