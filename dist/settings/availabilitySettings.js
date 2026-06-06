"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AvailabilitySettingsSchema = void 0;
const zod_1 = require("zod");
exports.AvailabilitySettingsSchema = zod_1.z.object({
    availableDays: zod_1.z.array(zod_1.z.number()).default([1, 2, 3, 4, 5]),
    startHour: zod_1.z.number().default(7),
    endHour: zod_1.z.number().default(17),
    slotDurationMinutes: zod_1.z.number().default(60),
    bufferMinutes: zod_1.z.number().default(15),
    maxAdvanceDays: zod_1.z.number().default(30),
    enabled: zod_1.z.boolean().default(true),
}).passthrough();
//# sourceMappingURL=availabilitySettings.js.map