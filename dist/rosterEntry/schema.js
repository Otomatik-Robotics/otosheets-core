"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RosterEntryCreateRequestSchema = exports.RosterEntryStoredSchema = void 0;
const zod_1 = require("zod");
exports.RosterEntryStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    sk: zod_1.z.string(),
    rosterId: zod_1.z.string(),
    memberId: zod_1.z.string(),
    date: zod_1.z.string(),
    startTime: zod_1.z.string(),
    endTime: zod_1.z.string(),
    rotationId: zod_1.z.string().nullish(),
    teamId: zod_1.z.string().nullish(),
    category: zod_1.z.string().nullish(),
    slotLabel: zod_1.z.string(),
    status: zod_1.z.enum(['draft', 'confirmed', 'swapped', 'cancelled']).default('draft'),
    swappedWith: zod_1.z.string().nullish(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
exports.RosterEntryCreateRequestSchema = zod_1.z.object({
    memberId: zod_1.z.string(),
    date: zod_1.z.string(),
    startTime: zod_1.z.string(),
    endTime: zod_1.z.string(),
    rotationId: zod_1.z.string().nullish(),
    teamId: zod_1.z.string().nullish(),
    category: zod_1.z.string().nullish(),
    slotLabel: zod_1.z.string(),
    status: zod_1.z.enum(['draft', 'confirmed', 'swapped', 'cancelled']).default('draft'),
});
//# sourceMappingURL=schema.js.map