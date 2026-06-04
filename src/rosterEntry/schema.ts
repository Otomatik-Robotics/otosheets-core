import { z } from 'zod';

export const RosterEntryStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(),
    rosterId: z.string(),
    memberId: z.string(),
    date: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    rotationId: z.string().nullish(),
    teamId: z.string().nullish(),
    category: z.string().nullish(),
    slotLabel: z.string(),
    status: z.enum(['draft', 'confirmed', 'swapped', 'cancelled']).default('draft'),
    swappedWith: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type RosterEntry = z.infer<typeof RosterEntryStoredSchema>;

export const RosterEntryCreateRequestSchema = z.object({
    memberId: z.string(),
    date: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    rotationId: z.string().nullish(),
    teamId: z.string().nullish(),
    category: z.string().nullish(),
    slotLabel: z.string(),
    status: z.enum(['draft', 'confirmed', 'swapped', 'cancelled']).default('draft'),
});
export type RosterEntryCreateRequest = z.infer<typeof RosterEntryCreateRequestSchema>;
