import { z } from 'zod';
export declare const AvailabilitySettingsSchema: z.ZodObject<{
    availableDays: z.ZodDefault<z.ZodArray<z.ZodNumber, "many">>;
    startHour: z.ZodDefault<z.ZodNumber>;
    endHour: z.ZodDefault<z.ZodNumber>;
    slotDurationMinutes: z.ZodDefault<z.ZodNumber>;
    bufferMinutes: z.ZodDefault<z.ZodNumber>;
    maxAdvanceDays: z.ZodDefault<z.ZodNumber>;
    enabled: z.ZodDefault<z.ZodBoolean>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    availableDays: z.ZodDefault<z.ZodArray<z.ZodNumber, "many">>;
    startHour: z.ZodDefault<z.ZodNumber>;
    endHour: z.ZodDefault<z.ZodNumber>;
    slotDurationMinutes: z.ZodDefault<z.ZodNumber>;
    bufferMinutes: z.ZodDefault<z.ZodNumber>;
    maxAdvanceDays: z.ZodDefault<z.ZodNumber>;
    enabled: z.ZodDefault<z.ZodBoolean>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    availableDays: z.ZodDefault<z.ZodArray<z.ZodNumber, "many">>;
    startHour: z.ZodDefault<z.ZodNumber>;
    endHour: z.ZodDefault<z.ZodNumber>;
    slotDurationMinutes: z.ZodDefault<z.ZodNumber>;
    bufferMinutes: z.ZodDefault<z.ZodNumber>;
    maxAdvanceDays: z.ZodDefault<z.ZodNumber>;
    enabled: z.ZodDefault<z.ZodBoolean>;
}, z.ZodTypeAny, "passthrough">>;
export type AvailabilitySettings = z.infer<typeof AvailabilitySettingsSchema>;
//# sourceMappingURL=availabilitySettings.d.ts.map