"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeadCreateRequestSchema = exports.LeadStoredSchema = exports.LeadBaseSchema = exports.StageHistoryEntrySchema = void 0;
const zod_1 = require("zod");
exports.StageHistoryEntrySchema = zod_1.z.object({
    id: zod_1.z.string(),
    stage: zod_1.z.string(),
    changedBy: zod_1.z.string().nullish(),
    changedAt: zod_1.z.string(),
});
exports.LeadBaseSchema = zod_1.z.object({
    leadId: zod_1.z.string(),
    source: zod_1.z.string(),
    pipelineId: zod_1.z.string().nullish(),
    adId: zod_1.z.string().nullish(),
    channelId: zod_1.z.string().nullish(),
    pageId: zod_1.z.string().nullish(),
    clientName: zod_1.z.string(),
    clientPhone: zod_1.z.string().nullish(),
    clientEmail: zod_1.z.string().nullish(),
    senderProfileName: zod_1.z.string().nullish(),
    senderId: zod_1.z.string().nullish(),
    suburb: zod_1.z.string().nullish(),
    serviceType: zod_1.z.string().nullish(),
    description: zod_1.z.string().nullish(),
    photos: zod_1.z.array(zod_1.z.string()).nullish(),
    urgency: zod_1.z.string().nullish(),
    stage: zod_1.z.string().default('NEW'),
    assignedTo: zod_1.z.string().nullish(),
    quotedAmount: zod_1.z.number().nullish(),
    bookingId: zod_1.z.string().nullish(),
    bookingDate: zod_1.z.string().nullish(),
    bookingTime: zod_1.z.string().nullish(),
    notes: zod_1.z.string().nullish(),
    conversationSummary: zod_1.z.string().nullish(),
    stageHistory: zod_1.z.array(exports.StageHistoryEntrySchema).default([]),
    orgStage: zod_1.z.string().nullish(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
exports.LeadStoredSchema = exports.LeadBaseSchema.extend({
    orgId: zod_1.z.string(),
    sk: zod_1.z.string(),
    createdBy: zod_1.z.string(),
});
exports.LeadCreateRequestSchema = zod_1.z.object({
    source: zod_1.z.string(),
    clientName: zod_1.z.string(),
    clientPhone: zod_1.z.string().nullish(),
    clientEmail: zod_1.z.string().nullish(),
    suburb: zod_1.z.string().nullish(),
    serviceType: zod_1.z.string().nullish(),
    description: zod_1.z.string().nullish(),
    photos: zod_1.z.array(zod_1.z.string()).nullish(),
    urgency: zod_1.z.string().nullish(),
    pipelineId: zod_1.z.string().nullish(),
    adId: zod_1.z.string().nullish(),
    channelId: zod_1.z.string().nullish(),
    pageId: zod_1.z.string().nullish(),
    senderId: zod_1.z.string().nullish(),
    senderProfileName: zod_1.z.string().nullish(),
});
//# sourceMappingURL=schema.js.map