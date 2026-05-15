import { z } from 'zod';

export const FollowUpStepSchema = z.object({
    name: z.string(),
    daysAfterDue: z.number(),
    tone: z.string(),
    subject: z.string(),
    body: z.string().nullish(),
}).passthrough();
export type FollowUpStep = z.infer<typeof FollowUpStepSchema>;

export const FollowUpSequenceSchema = z.object({
    enabled: z.boolean().default(true),
    stages: z.array(FollowUpStepSchema).default([]),
    minDaysBetweenReminders: z.number().default(3),
    maxReminders: z.number().default(10),
    autoChase: z.boolean().default(false),
}).passthrough();
export type FollowUpSequence = z.infer<typeof FollowUpSequenceSchema>;
