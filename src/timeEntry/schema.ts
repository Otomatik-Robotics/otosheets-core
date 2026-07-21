import { z } from 'zod';

export const TimeEntryBaseSchema = z.object({
    timeEntryId: z.string(),
    clientId: z.string().nullish(),
    jobId: z.string().nullish(),
    date: z.string(),
    startTime: z.string().nullish(),
    endTime: z.string().nullish(),
    durationMinutes: z.number(),
    description: z.string(),
    project: z.string().nullish(),
    billable: z.boolean().default(true),
    invoicedAt: z.string().nullish(),
    invoiceId: z.string().nullish(),
    /** How the entry came to exist: manual | job (start/end job) | auto (geofence auto-clock). */
    source: z.string().nullish(),
    /** Set when the worker confirmed the day's hours (GPS timesheets). */
    confirmedAt: z.string().nullish(),
    /** True when the worker corrected auto-logged hours — needs owner review. */
    disputed: z.boolean().nullish(),
    /** The auto-logged minutes before the worker's correction. */
    originalMinutes: z.number().nullish(),
    disputeNote: z.string().nullish(),
    /** Dispute review state: pending | approved | rejected. */
    approvalStatus: z.string().nullish(),
    approvedBy: z.string().nullish(),
    approvedAt: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type TimeEntryBase = z.infer<typeof TimeEntryBaseSchema>;

export const TimeEntryStoredSchema = TimeEntryBaseSchema.extend({
    orgId: z.string(),
    businessProfileId: z.string().nullish(),   // profile scope
    sk: z.string(),
    createdBy: z.string(),
});
export type TimeEntry = z.infer<typeof TimeEntryStoredSchema>;

export const TimeEntryCreateRequestSchema = z.object({
    clientId: z.string().nullish(),
    jobId: z.string().nullish(),
    date: z.string(),
    startTime: z.string().nullish(),
    endTime: z.string().nullish(),
    durationMinutes: z.number(),
    description: z.string(),
    project: z.string().nullish(),
    billable: z.boolean().optional(),
});
export type TimeEntryCreateRequest = z.infer<typeof TimeEntryCreateRequestSchema>;
