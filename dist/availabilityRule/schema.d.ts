import { z } from 'zod';
export declare const AvailabilityRuleStoredSchema: z.ZodObject<{
    orgId: z.ZodString;
    sk: z.ZodString;
    ruleId: z.ZodString;
    memberId: z.ZodString;
    dayOfWeek: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    startTime: z.ZodString;
    endTime: z.ZodString;
    effectiveFrom: z.ZodString;
    effectiveTo: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    recurrence: z.ZodEnum<["weekly", "fortnightly", "custom"]>;
    customIntervalDays: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    isAvailable: z.ZodDefault<z.ZodBoolean>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    createdAt: string;
    updatedAt: string;
    orgId: string;
    sk: string;
    memberId: string;
    startTime: string;
    endTime: string;
    ruleId: string;
    effectiveFrom: string;
    recurrence: "custom" | "weekly" | "fortnightly";
    isAvailable: boolean;
    dayOfWeek?: number | null | undefined;
    effectiveTo?: string | null | undefined;
    customIntervalDays?: number | null | undefined;
}, {
    createdAt: string;
    updatedAt: string;
    orgId: string;
    sk: string;
    memberId: string;
    startTime: string;
    endTime: string;
    ruleId: string;
    effectiveFrom: string;
    recurrence: "custom" | "weekly" | "fortnightly";
    dayOfWeek?: number | null | undefined;
    effectiveTo?: string | null | undefined;
    customIntervalDays?: number | null | undefined;
    isAvailable?: boolean | undefined;
}>;
export type AvailabilityRule = z.infer<typeof AvailabilityRuleStoredSchema>;
export declare const AvailabilityRuleCreateRequestSchema: z.ZodObject<{
    dayOfWeek: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    startTime: z.ZodString;
    endTime: z.ZodString;
    effectiveFrom: z.ZodString;
    effectiveTo: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    recurrence: z.ZodDefault<z.ZodEnum<["weekly", "fortnightly", "custom"]>>;
    customIntervalDays: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    isAvailable: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    startTime: string;
    endTime: string;
    effectiveFrom: string;
    recurrence: "custom" | "weekly" | "fortnightly";
    isAvailable: boolean;
    dayOfWeek?: number | null | undefined;
    effectiveTo?: string | null | undefined;
    customIntervalDays?: number | null | undefined;
}, {
    startTime: string;
    endTime: string;
    effectiveFrom: string;
    dayOfWeek?: number | null | undefined;
    effectiveTo?: string | null | undefined;
    recurrence?: "custom" | "weekly" | "fortnightly" | undefined;
    customIntervalDays?: number | null | undefined;
    isAvailable?: boolean | undefined;
}>;
export type AvailabilityRuleCreateRequest = z.infer<typeof AvailabilityRuleCreateRequestSchema>;
//# sourceMappingURL=schema.d.ts.map