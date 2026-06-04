import { z } from 'zod';

export const AvailabilityRuleStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(),
    ruleId: z.string(),
    memberId: z.string(),
    dayOfWeek: z.number().min(0).max(6).nullish(),
    startTime: z.string(),
    endTime: z.string(),
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullish(),
    recurrence: z.enum(['weekly', 'fortnightly', 'custom']),
    customIntervalDays: z.number().nullish(),
    isAvailable: z.boolean().default(true),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type AvailabilityRule = z.infer<typeof AvailabilityRuleStoredSchema>;

export const AvailabilityRuleCreateRequestSchema = z.object({
    dayOfWeek: z.number().min(0).max(6).nullish(),
    startTime: z.string(),
    endTime: z.string(),
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullish(),
    recurrence: z.enum(['weekly', 'fortnightly', 'custom']).default('weekly'),
    customIntervalDays: z.number().nullish(),
    isAvailable: z.boolean().default(true),
});
export type AvailabilityRuleCreateRequest = z.infer<typeof AvailabilityRuleCreateRequestSchema>;
