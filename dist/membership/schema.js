"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MembershipCreateRequestSchema = exports.MembershipStoredSchema = void 0;
const zod_1 = require("zod");
exports.MembershipStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    userId: zod_1.z.string(),
    membershipId: zod_1.z.string(),
    role: zod_1.z.string(),
    status: zod_1.z.string().default('PENDING'),
    firstName: zod_1.z.string().nullish(),
    lastName: zod_1.z.string().nullish(),
    inviteName: zod_1.z.string().nullish(),
    inviteToken: zod_1.z.string().nullish(),
    inviteExpiresAt: zod_1.z.string().nullish(),
    inviteEmail: zod_1.z.string().nullish(),
    invitePhone: zod_1.z.string().nullish(),
    invitedBy: zod_1.z.string().nullish(),
    invitedAt: zod_1.z.string().nullish(),
    joinedAt: zod_1.z.string().nullish(),
    availability: zod_1.z.any().nullish(),
    calendarConnection: zod_1.z.any().nullish(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
exports.MembershipCreateRequestSchema = zod_1.z.object({
    role: zod_1.z.string(),
    firstName: zod_1.z.string().nullish(),
    lastName: zod_1.z.string().nullish(),
    inviteName: zod_1.z.string().nullish(),
    inviteEmail: zod_1.z.string().nullish(),
    invitePhone: zod_1.z.string().nullish(),
});
//# sourceMappingURL=schema.js.map