"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FollowUpSequenceSchema = exports.FollowUpStepSchema = void 0;
const zod_1 = require("zod");
exports.FollowUpStepSchema = zod_1.z.object({
    name: zod_1.z.string(),
    daysAfterDue: zod_1.z.number(),
    tone: zod_1.z.string(),
    subject: zod_1.z.string(),
    body: zod_1.z.string().nullish(),
}).passthrough();
exports.FollowUpSequenceSchema = zod_1.z.object({
    enabled: zod_1.z.boolean().default(true),
    stages: zod_1.z.array(exports.FollowUpStepSchema).default([]),
    minDaysBetweenReminders: zod_1.z.number().default(3),
    maxReminders: zod_1.z.number().default(10),
    autoChase: zod_1.z.boolean().default(false),
}).passthrough();
//# sourceMappingURL=followUpSequence.js.map