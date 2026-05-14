"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TripCreateRequestSchema = exports.TripStoredSchema = void 0;
const zod_1 = require("zod");
exports.TripStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    sk: zod_1.z.string(),
    tripId: zod_1.z.string(),
    createdBy: zod_1.z.string(),
    startTime: zod_1.z.string().nullish(),
    endTime: zod_1.z.string().nullish(),
    startAddress: zod_1.z.string().nullish(),
    endAddress: zod_1.z.string().nullish(),
    distanceKm: zod_1.z.number(),
    purpose: zod_1.z.string().default('UNVERIFIED'),
    notes: zod_1.z.string().nullish(),
    coordinates: zod_1.z.any().nullish(),
    date: zod_1.z.string(),
    jobId: zod_1.z.string().nullish(),
    dateSk: zod_1.z.string().nullish(),
    createdAt: zod_1.z.string(),
});
exports.TripCreateRequestSchema = zod_1.z.object({
    startTime: zod_1.z.string().nullish(),
    endTime: zod_1.z.string().nullish(),
    startAddress: zod_1.z.string().nullish(),
    endAddress: zod_1.z.string().nullish(),
    distanceKm: zod_1.z.number(),
    purpose: zod_1.z.string().optional(),
    notes: zod_1.z.string().nullish(),
    coordinates: zod_1.z.any().nullish(),
    date: zod_1.z.string(),
    jobId: zod_1.z.string().nullish(),
});
//# sourceMappingURL=schema.js.map