import { z } from 'zod';

export const StageHistoryEntrySchema = z.object({
    id: z.string(),
    stage: z.string(),
    changedBy: z.string().nullish(),
    changedAt: z.string(),
});
export type StageHistoryEntry = z.infer<typeof StageHistoryEntrySchema>;

export const LeadBaseSchema = z.object({
    leadId: z.string(),
    source: z.string(),
    pipelineId: z.string().nullish(),
    adId: z.string().nullish(),
    channelId: z.string().nullish(),
    pageId: z.string().nullish(),
    clientName: z.string(),
    clientPhone: z.string().nullish(),
    clientEmail: z.string().nullish(),
    senderProfileName: z.string().nullish(),
    senderId: z.string().nullish(),
    suburb: z.string().nullish(),
    serviceType: z.string().nullish(),
    description: z.string().nullish(),
    photos: z.array(z.string()).nullish(),
    urgency: z.string().nullish(),
    stage: z.string().default('NEW'),
    assignedTo: z.string().nullish(),
    quotedAmount: z.number().nullish(),
    bookingId: z.string().nullish(),
    bookingDate: z.string().nullish(),
    bookingTime: z.string().nullish(),
    notes: z.string().nullish(),
    conversationSummary: z.string().nullish(),
    /** Manual voice-calling opt-out — the dial queue must never call this lead */
    doNotCall: z.boolean().nullish(),
    stageHistory: z.array(StageHistoryEntrySchema).default([]),
    orgStage: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type LeadBase = z.infer<typeof LeadBaseSchema>;

export const LeadStoredSchema = LeadBaseSchema.extend({
    orgId: z.string(),
    businessProfileId: z.string().nullish(),   // profile scope
    sk: z.string(),
    createdBy: z.string(),
});
export type Lead = z.infer<typeof LeadStoredSchema>;

export const LeadCreateRequestSchema = z.object({
    source: z.string(),
    clientName: z.string(),
    clientPhone: z.string().nullish(),
    clientEmail: z.string().nullish(),
    suburb: z.string().nullish(),
    serviceType: z.string().nullish(),
    description: z.string().nullish(),
    photos: z.array(z.string()).nullish(),
    urgency: z.string().nullish(),
    pipelineId: z.string().nullish(),
    adId: z.string().nullish(),
    channelId: z.string().nullish(),
    pageId: z.string().nullish(),
    senderId: z.string().nullish(),
    senderProfileName: z.string().nullish(),
});
export type LeadCreateRequest = z.infer<typeof LeadCreateRequestSchema>;
