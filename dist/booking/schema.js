"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingCreateRequestSchema = exports.BookingStoredSchema = exports.BookingBaseSchema = void 0;
const zod_1 = require("zod");
exports.BookingBaseSchema = zod_1.z.object({
    bookingId: zod_1.z.string(),
    date: zod_1.z.string(),
    startTime: zod_1.z.string(),
    endTime: zod_1.z.string(),
    clientName: zod_1.z.string(),
    clientPhone: zod_1.z.string().nullish(),
    clientEmail: zod_1.z.string().nullish(),
    serviceType: zod_1.z.string().nullish(),
    suburb: zod_1.z.string().nullish(),
    notes: zod_1.z.string().nullish(),
    status: zod_1.z.string().default('CONFIRMED'),
    source: zod_1.z.string(),
    sourceName: zod_1.z.string().nullish(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
exports.BookingStoredSchema = exports.BookingBaseSchema.extend({
    orgId: zod_1.z.string(),
    sk: zod_1.z.string(),
    createdBy: zod_1.z.string(),
    dateSk: zod_1.z.string().nullish(),
});
exports.BookingCreateRequestSchema = zod_1.z.object({
    date: zod_1.z.string(),
    startTime: zod_1.z.string(),
    endTime: zod_1.z.string(),
    clientName: zod_1.z.string(),
    clientPhone: zod_1.z.string().nullish(),
    clientEmail: zod_1.z.string().nullish(),
    serviceType: zod_1.z.string().nullish(),
    suburb: zod_1.z.string().nullish(),
    notes: zod_1.z.string().nullish(),
    source: zod_1.z.string(),
    sourceName: zod_1.z.string().nullish(),
});
//# sourceMappingURL=schema.js.map