import { z } from 'zod';

export const RotationSlotSchema = z.object({
    label: z.string(),
    memberIds: z.array(z.string()),
});
export type RotationSlot = z.infer<typeof RotationSlotSchema>;

export const RotationStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(),
    rotationId: z.string(),
    name: z.string(),
    description: z.string().nullish(),
    teamId: z.string().nullish(),
    category: z.string().nullish(),
    frequency: z.enum(['weekly', 'fortnightly', 'monthly', 'custom']),
    customFrequencyDays: z.number().nullish(),
    anchorDate: z.string(),
    slots: z.array(RotationSlotSchema),
    createdBy: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Rotation = z.infer<typeof RotationStoredSchema>;

export const RotationCreateRequestSchema = z.object({
    name: z.string(),
    description: z.string().nullish(),
    teamId: z.string().nullish(),
    category: z.string().nullish(),
    frequency: z.enum(['weekly', 'fortnightly', 'monthly', 'custom']),
    customFrequencyDays: z.number().nullish(),
    anchorDate: z.string(),
    slots: z.array(RotationSlotSchema),
});
export type RotationCreateRequest = z.infer<typeof RotationCreateRequestSchema>;
