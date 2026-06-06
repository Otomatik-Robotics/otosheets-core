"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelineCreateRequestSchema = exports.PipelineStoredSchema = exports.PipelineBaseSchema = exports.PipelineSourceSchema = void 0;
const zod_1 = require("zod");
exports.PipelineSourceSchema = zod_1.z.object({
    id: zod_1.z.string(),
    sourceType: zod_1.z.string(),
    channelId: zod_1.z.string().nullish(),
    channelName: zod_1.z.string().nullish(),
    addedAt: zod_1.z.string(),
});
exports.PipelineBaseSchema = zod_1.z.object({
    pipelineId: zod_1.z.string(),
    name: zod_1.z.string(),
    description: zod_1.z.string().nullish(),
    stages: zod_1.z.array(zod_1.z.string()),
    isDefault: zod_1.z.boolean().default(false),
    sources: zod_1.z.array(exports.PipelineSourceSchema).default([]),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
exports.PipelineStoredSchema = exports.PipelineBaseSchema.extend({
    orgId: zod_1.z.string(),
    createdBy: zod_1.z.string(),
});
exports.PipelineCreateRequestSchema = zod_1.z.object({
    name: zod_1.z.string(),
    description: zod_1.z.string().nullish(),
    stages: zod_1.z.array(zod_1.z.string()),
    isDefault: zod_1.z.boolean().optional(),
    sources: zod_1.z.array(exports.PipelineSourceSchema).optional(),
});
//# sourceMappingURL=schema.js.map