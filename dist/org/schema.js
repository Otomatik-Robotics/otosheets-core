"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrgCreateRequestSchema = exports.OrgStoredSchema = void 0;
const zod_1 = require("zod");
exports.OrgStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    name: zod_1.z.string(),
    legalName: zod_1.z.string().nullish(),
    tradeName: zod_1.z.string().nullish(),
    slug: zod_1.z.string().nullish(),
    abn: zod_1.z.string().nullish(),
    gstRegistered: zod_1.z.boolean().default(false),
    currency: zod_1.z.string().default('AUD'),
    taxRate: zod_1.z.number().nullish(),
    logoUrl: zod_1.z.string().nullish(),
    brandColor: zod_1.z.string().nullish(),
    tagline: zod_1.z.string().nullish(),
    emailSignature: zod_1.z.string().nullish(),
    bookingSettings: zod_1.z.any().nullish(),
    tradeSettings: zod_1.z.any().nullish(),
    stripeAccountId: zod_1.z.string().nullish(),
    encryptedDek: zod_1.z.string().nullish(),
    dekVersion: zod_1.z.number().nullish(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
exports.OrgCreateRequestSchema = zod_1.z.object({
    name: zod_1.z.string(),
    legalName: zod_1.z.string().nullish(),
    tradeName: zod_1.z.string().nullish(),
    slug: zod_1.z.string().nullish(),
    abn: zod_1.z.string().nullish(),
    gstRegistered: zod_1.z.boolean().optional(),
    currency: zod_1.z.string().optional(),
    taxRate: zod_1.z.number().nullish(),
});
//# sourceMappingURL=schema.js.map