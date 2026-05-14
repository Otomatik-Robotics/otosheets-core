"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationCreateRequestSchema = exports.ConversationStoredSchema = void 0;
const zod_1 = require("zod");
exports.ConversationStoredSchema = zod_1.z.object({
    userId: zod_1.z.string(),
    conversationId: zod_1.z.string(),
    organizationId: zod_1.z.string().nullish(),
    title: zod_1.z.string(),
    messages: zod_1.z.any().nullish(),
    messageCount: zod_1.z.number().default(0),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
exports.ConversationCreateRequestSchema = zod_1.z.object({
    title: zod_1.z.string(),
    organizationId: zod_1.z.string().nullish(),
});
//# sourceMappingURL=schema.js.map