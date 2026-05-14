"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationCreateRequestSchema = exports.NotificationStoredSchema = void 0;
const zod_1 = require("zod");
exports.NotificationStoredSchema = zod_1.z.object({
    userId: zod_1.z.string(),
    notificationId: zod_1.z.string(),
    organizationId: zod_1.z.string().nullish(),
    type: zod_1.z.string(),
    title: zod_1.z.string(),
    body: zod_1.z.string(),
    read: zod_1.z.boolean().default(false),
    link: zod_1.z.string().nullish(),
    priority: zod_1.z.string().nullish(),
    meta: zod_1.z.any().nullish(),
    ttl: zod_1.z.number().nullish(),
    createdAt: zod_1.z.string(),
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