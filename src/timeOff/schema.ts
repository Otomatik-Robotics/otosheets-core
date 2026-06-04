import { z } from 'zod';

export const TimeOffStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(),
    timeOffId: z.string(),
    memberId: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    allDay: z.boolean().default(true),
    startTime: z.string().nullish(),
    endTime: z.string().nullish(),
    reason: z.enum(['holiday', 'sick', 'personal', 'other']),
    notes: z.string().nullish(),
    approved: z.boolean().default(false),
    approvedBy: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type TimeOff = z.infer<typeof TimeOffStoredSchema>;

export const TimeOffCreateRequestSchema = z.object({
    startDate: z.string(),
    endDate: z.string(),
    allDay: z.boolean().default(true),
    startTime: z.string().nullish(),
    endTime: z.string().nullish(),
    reason: z.enum(['holiday', 'sick', 'personal', 'other']),
    notes: z.string().nullish(),
    approved: z.boolean().default(false),
});
export type TimeOffCreateRequest = z.infer<typeof TimeOffCreateRequestSchema>;
