"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RotationCreateRequestSchema = exports.RotationStoredSchema = exports.RotationSlotSchema = void 0;
const zod_1 = require("zod");
exports.RotationSlotSchema = zod_1.z.object({
    label: zod_1.z.string(),
    memberIds: zod_1.z.array(zod_1.z.string()),
});
exports.RotationStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    sk: zod_1.z.string(),
    rotationId: zod_1.z.string(),
    name: zod_1.z.string(),
    description: zod_1.z.string().nullish(),
    teamId: zod_1.z.string().nullish(),
    category: zod_1.z.string().nullish(),
    frequency: zod_1.z.enum(['weekly', 'fortnightly', 'monthly', 'custom']),
    customFrequencyDays: zod_1.z.number().nullish(),
    anchorDate: zod_1.z.string(),
    slots: zod_1.z.array(exports.RotationSlotSchema),
    createdBy: zod_1.z.string(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
exports.RotationCreateRequestSchema = zod_1.z.object({
    name: zod_1.z.string(),
    description: zod_1.z.string().nullish(),
    teamId: zod_1.z.string().nullish(),
    category: zod_1.z.string().nullish(),
    frequency: zod_1.z.enum(['weekly', 'fortnightly', 'monthly', 'custom']),
    customFrequencyDays: zod_1.z.number().nullish(),
    anchorDate: zod_1.z.string(),
    slots: zod_1.z.array(exports.RotationSlotSchema),
});
//# sourceMappingURL=schema.js.map