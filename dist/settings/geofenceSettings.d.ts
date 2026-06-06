import { z } from 'zod';
export declare const GeofenceSettingsSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    radiusMetres: z.ZodDefault<z.ZodNumber>;
    requireStartGeofence: z.ZodDefault<z.ZodBoolean>;
    requireEndGeofence: z.ZodDefault<z.ZodBoolean>;
    pingIntervalSeconds: z.ZodDefault<z.ZodNumber>;
    allowOverride: z.ZodDefault<z.ZodBoolean>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    radiusMetres: z.ZodDefault<z.ZodNumber>;
    requireStartGeofence: z.ZodDefault<z.ZodBoolean>;
    requireEndGeofence: z.ZodDefault<z.ZodBoolean>;
    pingIntervalSeconds: z.ZodDefault<z.ZodNumber>;
    allowOverride: z.ZodDefault<z.ZodBoolean>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    radiusMetres: z.ZodDefault<z.ZodNumber>;
    requireStartGeofence: z.ZodDefault<z.ZodBoolean>;
    requireEndGeofence: z.ZodDefault<z.ZodBoolean>;
    pingIntervalSeconds: z.ZodDefault<z.ZodNumber>;
    allowOverride: z.ZodDefault<z.ZodBoolean>;
}, z.ZodTypeAny, "passthrough">>;
export type GeofenceSettings = z.infer<typeof GeofenceSettingsSchema>;
//# sourceMappingURL=geofenceSettings.d.ts.map