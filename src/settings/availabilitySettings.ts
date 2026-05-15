import { z } from 'zod';

export const AvailabilitySettingsSchema = z.object({
    availableDays: z.array(z.number()).default([1, 2, 3, 4, 5]),
    startHour: z.number().default(7),
    endHour: z.number().default(17),
    slotDurationMinutes: z.number().default(60),
    bufferMinutes: z.number().default(15),
    maxAdvanceDays: z.number().default(30),
    enabled: z.boolean().default(true),
}).passthrough();
export type AvailabilitySettings = z.infer<typeof AvailabilitySettingsSchema>;
