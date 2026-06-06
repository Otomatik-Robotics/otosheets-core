"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatMessageCreateRequestSchema = exports.ChatMessageStoredSchema = exports.ChatAttachmentSchema = void 0;
const zod_1 = require("zod");
exports.ChatAttachmentSchema = zod_1.z.object({
    attachmentId: zod_1.z.string(),
    type: zod_1.z.string(),
    fileName: zod_1.z.string(),
    fileType: zod_1.z.string(),
    fileSize: zod_1.z.number(),
    s3Key: zod_1.z.string(),
    duration: zod_1.z.number().nullish(),
}).passthrough();
exports.ChatMessageStoredSchema = zod_1.z.object({
    conversationId: zod_1.z.string(),
    messageId: zod_1.z.string(),
    senderId: zod_1.z.string(),
    senderName: zod_1.z.string(),
    content: zod_1.z.string(),
    timestamp: zod_1.z.string(),
    attachments: zod_1.z.array(exports.ChatAttachmentSchema).nullish(),
    status: zod_1.z.string().default('sent'),
    encryptedAt: zod_1.z.string().nullish(),
});
exports.ChatMessageCreateRequestSchema = zod_1.z.object({
    content: zod_1.z.string(),
    attachments: zod_1.z.array(exports.ChatAttachmentSchema).nullish(),
});
//# sourceMappingURL=schema.js.map