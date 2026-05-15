import { z } from 'zod';

export const GeofenceSettingsSchema = z.object({
    enabled: z.boolean().default(true),
    radiusMetres: z.number().default(200),
    requireStartGeofence: z.boolean().default(true),
    requireEndGeofence: z.boolean().default(false),
    pingIntervalSeconds: z.number().default(300),
    allowOverride: z.boolean().default(true),
}).passthrough();
export type GeofenceSettings = z.infer<typeof GeofenceSettingsSchema>;
