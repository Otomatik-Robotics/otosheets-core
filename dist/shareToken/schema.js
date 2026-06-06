"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShareTokenCreateRequestSchema = exports.ShareTokenStoredSchema = void 0;
const zod_1 = require("zod");
exports.ShareTokenStoredSchema = zod_1.z.object({
    token: zod_1.z.string(),
    userId: zod_1.z.string(),
    fy: zod_1.z.string(),
    label: zod_1.z.string(),
    accessCount: zod_1.z.number().default(0),
    expiresAt: zod_1.z.string(),
    createdAt: zod_1.z.string(),
    ttl: zod_1.z.number().nullish(),
});
exports.ShareTokenCreateRequestSchema = zod_1.z.object({
    fy: zod_1.z.string(),
    label: zod_1.z.string(),
    expiryDays: zod_1.z.number().default(30),
});
//# sourceMappingURL=schema.js.map