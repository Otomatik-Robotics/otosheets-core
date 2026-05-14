"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdCreateRequestSchema = exports.AdStoredSchema = void 0;
const zod_1 = require("zod");
exports.AdStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    sk: zod_1.z.string(),
    adId: zod_1.z.string(),
    createdBy: zod_1.z.string(),
    status: zod_1.z.string().default('DRAFT'),
    mediaKeys: zod_1.z.array(zod_1.z.string()).nullish(),
    mediaAnalyses: zod_1.z.any().nullish(),
    adCopy: zod_1.z.any().nullish(),
    selectedCopy: zod_1.z.number().nullish(),
    storyboard: zod_1.z.any().nullish(),
    brollScenes: zod_1.z.any().nullish(),
    creativeBrief: zod_1.z.any().nullish(),
    renderedVideoKey: zod_1.z.string().nullish(),
    previewVideoKey: zod_1.z.string().nullish(),
    targetAudience: zod_1.z.string().nullish(),
    location: zod_1.z.string().nullish(),
    headline: zod_1.z.string().nullish(),
    primaryText: zod_1.z.string().nullish(),
    callToAction: zod_1.z.string().nullish(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
exports.AdCreateRequestSchema = zod_1.z.object({
    mediaKeys: zod_1.z.array(zod_1.z.string()).nullish(),
    targetAudience: zod_1.z.string().nullish(),
    location: zod_1.z.string().nullish(),
});
//# sourceMappingURL=schema.js.map