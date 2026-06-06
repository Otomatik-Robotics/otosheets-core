"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationCreateRequestSchema = exports.NotificationStoredSchema = exports.NotificationBaseSchema = void 0;
const zod_1 = require("zod");
exports.NotificationBaseSchema = zod_1.z.object({
    notificationId: zod_1.z.string(),
    type: zod_1.z.string(),
    title: zod_1.z.string(),
    body: zod_1.z.string(),
    read: zod_1.z.boolean().default(false),
    link: zod_1.z.string().nullish(),
    priority: zod_1.z.string().nullish(),
    meta: zod_1.z.any().nullish(),
    createdAt: zod_1.z.string(),
});
exports.NotificationStoredSchema = exports.NotificationBaseSchema.extend({
    userId: zod_1.z.string(),
    organizationId: zod_1.z.string().nullish(),
    ttl: zod_1.z.number().nullish(),
});
exports.NotificationCreateRequestSchema = zod_1.z.object({
    type: zod_1.z.string(),
    title: zod_1.z.string(),
    body: zod_1.z.string(),
    link: zod_1.z.string().nullish(),
    priority: zod_1.z.string().nullish(),
    meta: zod_1.z.any().nullish(),
    organizationId: zod_1.z.string().nullish(),
});
//# sourceMappingURL=schema.js.map