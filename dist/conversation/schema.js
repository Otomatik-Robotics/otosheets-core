"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationCreateRequestSchema = exports.ConversationStoredSchema = exports.ConversationBaseSchema = void 0;
const zod_1 = require("zod");
exports.ConversationBaseSchema = zod_1.z.object({
    conversationId: zod_1.z.string(),
    title: zod_1.z.string(),
    messages: zod_1.z.any().nullish(),
    messageCount: zod_1.z.number().default(0),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
exports.ConversationStoredSchema = exports.ConversationBaseSchema.extend({
    userId: zod_1.z.string(),
    organizationId: zod_1.z.string().nullish(),
});
exports.ConversationCreateRequestSchema = zod_1.z.object({
    title: zod_1.z.string(),
    organizationId: zod_1.z.string().nullish(),
});
//# sourceMappingURL=schema.js.map