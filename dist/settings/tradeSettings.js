"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TradeSettingsSchema = exports.ComplianceCertSchema = void 0;
const zod_1 = require("zod");
const branding_1 = require("./branding");
const geofenceSettings_1 = require("./geofenceSettings");
exports.ComplianceCertSchema = zod_1.z.object({
    name: zod_1.z.string(),
    number: zod_1.z.string(),
    expiry: zod_1.z.string(),
}).passthrough();
exports.TradeSettingsSchema = zod_1.z.object({
    tradeName: zod_1.z.string().nullish(),
    licenceNumber: zod_1.z.string().nullish(),
    licenceExpiry: zod_1.z.string().nullish(),
    warrantyPeriod: zod_1.z.string().nullish(),
    certPrefix: zod_1.z.string().nullish(),
    insurancePolicyNumber: zod_1.z.string().nullish(),
    insuranceExpiry: zod_1.z.string().nullish(),
    complianceCerts: zod_1.z.array(exports.ComplianceCertSchema).nullish(),
    branding: branding_1.BrandingSchema.nullish(),
    geofenceSettings: geofenceSettings_1.GeofenceSettingsSchema.nullish(),
    address: zod_1.z.string().nullish(),
    email: zod_1.z.string().nullish(),
    bankName: zod_1.z.string().nullish(),
    bsb: zod_1.z.string().nullish(),
    accountNumber: zod_1.z.string().nullish(),
}).passthrough();
//# sourceMappingURL=tradeSettings.js.map