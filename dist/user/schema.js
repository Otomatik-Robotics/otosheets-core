"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserCreateRequestSchema = exports.UserStoredSchema = void 0;
const zod_1 = require("zod");
exports.UserStoredSchema = zod_1.z.object({
    userId: zod_1.z.string(),
    email: zod_1.z.string().email(),
    firstName: zod_1.z.string().nullish(),
    lastName: zod_1.z.string().nullish(),
    fullName: zod_1.z.string(),
    businessName: zod_1.z.string().nullish(),
    tradeName: zod_1.z.string().nullish(),
    slug: zod_1.z.string().nullish(),
    timezone: zod_1.z.string().default('Australia/Sydney'),
    tagline: zod_1.z.string().nullish(),
    brandColor: zod_1.z.string().nullish(),
    logoUrl: zod_1.z.string().nullish(),
    status: zod_1.z.string().default('ACTIVE'),
    profilePictureKey: zod_1.z.string().nullish(),
    phone: zod_1.z.string().nullish(),
    stripeAccountId: zod_1.z.string().nullish(),
    stripeCustomerId: zod_1.z.string().nullish(),
    subscriptionTier: zod_1.z.string().nullish(),
    subscriptionStatus: zod_1.z.string().nullish(),
    categoryRules: zod_1.z.record(zod_1.z.string(), zod_1.z.string()).nullish(),
    bookingSettings: zod_1.z.any().nullish(),
    calendarConnections: zod_1.z.any().nullish(),
    metaPages: zod_1.z.any().nullish(),
    tradeSettings: zod_1.z.any().nullish(),
    emailConnections: zod_1.z.any().nullish(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
exports.UserCreateRequestSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    fullName: zod_1.z.string(),
    firstName: zod_1.z.string().nullish(),
    lastName: zod_1.z.string().nullish(),
    businessName: zod_1.z.string().nullish(),
    tradeName: zod_1.z.string().nullish(),
    slug: zod_1.z.string().nullish(),
    timezone: zod_1.z.string().optional(),
    phone: zod_1.z.string().nullish(),
});
//# sourceMappingURL=schema.js.map