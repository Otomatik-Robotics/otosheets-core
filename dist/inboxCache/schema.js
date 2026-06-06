"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InboxCacheCreateRequestSchema = exports.InboxCacheStoredSchema = void 0;
const zod_1 = require("zod");
exports.InboxCacheStoredSchema = zod_1.z.object({
    userId: zod_1.z.string(),
    gmailId: zod_1.z.string(),
    threadId: zod_1.z.string(),
    from: zod_1.z.string(),
    subject: zod_1.z.string(),
    snippet: zod_1.z.string(),
    date: zod_1.z.string(),
    category: zod_1.z.string().nullish(),
    clientId: zod_1.z.string().nullish(),
    clientName: zod_1.z.string().nullish(),
    cachedAt: zod_1.z.string(),
    ttl: zod_1.z.number().nullish(),
});
exports.InboxCacheCreateRequestSchema = zod_1.z.object({
    gmailId: zod_1.z.string(),
    threadId: zod_1.z.string(),
    from: zod_1.z.string(),
    subject: zod_1.z.string(),
    snippet: zod_1.z.string(),
    date: zod_1.z.string(),
    category: zod_1.z.string().nullish(),
    clientId: zod_1.z.string().nullish(),
    clientName: zod_1.z.string().nullish(),
});
//# sourceMappingURL=schema.js.map