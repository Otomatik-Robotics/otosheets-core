"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeofenceSettingsSchema = void 0;
const zod_1 = require("zod");
exports.GeofenceSettingsSchema = zod_1.z.object({
    enabled: zod_1.z.boolean().default(true),
    radiusMetres: zod_1.z.number().default(200),
    requireStartGeofence: zod_1.z.boolean().default(true),
    requireEndGeofence: zod_1.z.boolean().default(false),
    pingIntervalSeconds: zod_1.z.number().default(300),
    allowOverride: zod_1.z.boolean().default(true),
}).passthrough();
//# sourceMappingURL=geofenceSettings.js.map