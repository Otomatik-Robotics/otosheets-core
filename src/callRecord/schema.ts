import { z } from 'zod';

export const CALL_RECORD_STATUSES = ['QUEUED', 'DIALING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'NO_ANSWER', 'BLOCKED'] as const;
export const CallRecordStatusSchema = z.enum(CALL_RECORD_STATUSES);
export type CallRecordStatus = z.infer<typeof CallRecordStatusSchema>;

export const CallRecordStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(), // CALL#{leadId}#{callId}
    callId: z.string(),
    leadId: z.string(),
    pipelineId: z.string().nullish(),
    provider: z.string().default('vapi'),
    /** Provider-side call id (e.g. Vapi call id), set once dialing starts */
    externalId: z.string().nullish(),
    phoneNumber: z.string(),
    status: CallRecordStatusSchema,
    /** Why the compliance gate blocked the call (DNCR, calling hours, consent, rate limit) */
    blockReason: z.string().nullish(),
    /** Short outcome summary of the completed call */
    outcome: z.string().nullish(),
    transcript: z.string().nullish(),
    recordingUrl: z.string().nullish(),
    durationSeconds: z.number().nullish(),
    scriptPrompt: z.string().nullish(),
    startedAt: z.string().nullish(),
    endedAt: z.string().nullish(),
    createdBy: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type CallRecord = z.infer<typeof CallRecordStoredSchema>;
