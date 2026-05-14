import { z } from 'zod';

export const TimeEntryStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(),
    timeEntryId: z.string(),
    createdBy: z.string(),
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
    createdAt: z.string(),
    updatedAt: z.string(),
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
