import { z } from 'zod';

export const CALL_RECORD_STATUSES = ['QUEUED', 'DIALING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'NO_ANSWER', 'BLOCKED', 'CANCELLED'] as const;
export const CallRecordStatusSchema = z.enum(CALL_RECORD_STATUSES);
export type CallRecordStatus = z.infer<typeof CallRecordStatusSchema>;

export const CALL_DIRECTIONS = ['inbound', 'outbound'] as const;
export const CallDirectionSchema = z.enum(CALL_DIRECTIONS);
export type CallDirection = z.infer<typeof CallDirectionSchema>;

/**
 * One timed utterance in a call transcript. `startSec`/`endSec` are seconds from
 * the start of the recording, enabling playback-synced ("karaoke") highlighting
 * and click-to-seek in the UI. Optional alongside the flat `transcript` string —
 * older calls only have the string.
 */
export const TranscriptSegmentSchema = z.object({
    speaker: z.enum(['ai', 'user']),
    text: z.string(),
    startSec: z.number(),
    endSec: z.number().nullish(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

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
    /** inbound = received, outbound = placed. Default outbound on read for legacy rows. */
    direction: CallDirectionSchema.nullish(),
    /**
     * On the org-wide inbound-active marker only: the lead the in-call AI captured
     * (via capture_lead). Read back at the inbound end-of-call report so the saved
     * call-history record can be linked to that lead. Not set on normal call rows.
     */
    capturedLeadId: z.string().nullish(),
    capturedPipelineId: z.string().nullish(),
    /** Earliest dial time — the cooldown window before this lets the user cancel */
    dialAt: z.string().nullish(),
    /** Voice agent assigned to place/answer this call */
    agentId: z.string().nullish(),
    /** Vapi phone-number id this call dials FROM — the per-number serialization key (outbound only). */
    outboundNumberId: z.string().nullish(),
    /**
     * Sparse `activeByNumber` GSI partition marker — `${orgId}#${outboundNumberId}`,
     * present ONLY while an outbound call is live (QUEUED/DIALING/IN_PROGRESS).
     * Cleared (REMOVE) the moment the call reaches a terminal status so the index
     * holds only in-flight calls. Backs "one call at a time per number".
     */
    activeNumberShard: z.string().nullish(),
    /** Why the compliance gate blocked the call (DNCR, calling hours, consent, rate limit) */
    blockReason: z.string().nullish(),
    /** Short outcome summary of the completed call */
    outcome: z.string().nullish(),
    transcript: z.string().nullish(),
    /** Timed, speaker-attributed transcript turns for playback-synced highlighting. */
    transcriptSegments: z.array(TranscriptSegmentSchema).nullish(),
    recordingUrl: z.string().nullish(),
    durationSeconds: z.number().nullish(),
    scriptPrompt: z.string().nullish(),
    startedAt: z.string().nullish(),
    endedAt: z.string().nullish(),
    /** Dial attempts made on this retry chain so far (1 after the first dial). */
    attemptCount: z.number().int().nullish(),
    /** ISO time the retry sweep should next re-dial this call (NO_ANSWER + retry enabled). */
    nextAttemptAt: z.string().nullish(),
    /** Sparse `retryDue` GSI partition marker — present ONLY while awaiting a scheduled retry. */
    retryShard: z.string().nullish(),
    createdBy: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type CallRecord = z.infer<typeof CallRecordStoredSchema>;
