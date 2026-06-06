import { z } from 'zod';
export declare const RotationSlotSchema: z.ZodObject<{
    label: z.ZodString;
    memberIds: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    memberIds: string[];
    label: string;
}, {
    memberIds: string[];
    label: string;
}>;
export type RotationSlot = z.infer<typeof RotationSlotSchema>;
export declare const RotationStoredSchema: z.ZodObject<{
    orgId: z.ZodString;
    sk: z.ZodString;
    rotationId: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    teamId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    frequency: z.ZodEnum<["weekly", "fortnightly", "monthly", "custom"]>;
    customFrequencyDays: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    anchorDate: z.ZodString;
    slots: z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        memberIds: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        memberIds: string[];
        label: string;
    }, {
        memberIds: string[];
        label: string;
    }>, "many">;
    createdBy: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    createdAt: string;
    updatedAt: string;
    orgId: string;
    createdBy: string;
    sk: string;
    rotationId: string;
    frequency: "custom" | "weekly" | "fortnightly" | "monthly";
    anchorDate: string;
    slots: {
        memberIds: string[];
        label: string;
    }[];
    teamId?: string | null | undefined;
    description?: string | null | undefined;
    category?: string | null | undefined;
    customFrequencyDays?: number | null | undefined;
}, {
    name: string;
    createdAt: string;
    updatedAt: string;
    orgId: string;
    createdBy: string;
    sk: string;
    rotationId: string;
    frequency: "custom" | "weekly" | "fortnightly" | "monthly";
    anchorDate: string;
    slots: {
        memberIds: string[];
        label: string;
    }[];
    teamId?: string | null | undefined;
    description?: string | null | undefined;
    category?: string | null | undefined;
    customFrequencyDays?: number | null | undefined;
}>;
export type Rotation = z.infer<typeof RotationStoredSchema>;
export declare const RotationCreateRequestSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    teamId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    frequency: z.ZodEnum<["weekly", "fortnightly", "monthly", "custom"]>;
    customFrequencyDays: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    anchorDate: z.ZodString;
    slots: z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        memberIds: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        memberIds: string[];
        label: string;
    }, {
        memberIds: string[];
        label: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    name: string;
    frequency: "custom" | "weekly" | "fortnightly" | "monthly";
    anchorDate: string;
    slots: {
        memberIds: string[];
        label: string;
    }[];
    teamId?: string | null | undefined;
    description?: string | null | undefined;
    category?: string | null | undefined;
    customFrequencyDays?: number | null | undefined;
}, {
    name: string;
    frequency: "custom" | "weekly" | "fortnightly" | "monthly";
    anchorDate: string;
    slots: {
        memberIds: string[];
        label: string;
    }[];
    teamId?: string | null | undefined;
    description?: string | null | undefined;
    category?: string | null | undefined;
    customFrequencyDays?: number | null | undefined;
}>;
export type RotationCreateRequest = z.infer<typeof RotationCreateRequestSchema>;
//# sourceMappingURL=schema.d.ts.map