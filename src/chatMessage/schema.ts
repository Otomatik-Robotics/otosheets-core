import { z } from 'zod';

export const ChatAttachmentSchema = z.object({
    attachmentId: z.string(),
    type: z.string(),
    fileName: z.string(),
    fileType: z.string(),
    fileSize: z.number(),
    s3Key: z.string(),
    duration: z.number().nullish(),
}).passthrough();
export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

export const ChatMessageStoredSchema = z.object({
    conversationId: z.string(),
    messageId: z.string(),
    senderId: z.string(),
    senderName: z.string(),
    content: z.string(),
    timestamp: z.string(),
    attachments: z.array(ChatAttachmentSchema).nullish(),
    status: z.string().default('sent'),
    encryptedAt: z.string().nullish(),
});
export type ChatMessage = z.infer<typeof ChatMessageStoredSchema>;

export const ChatMessageCreateRequestSchema = z.object({
    content: z.string(),
    attachments: z.array(ChatAttachmentSchema).nullish(),
});
export type ChatMessageCreateRequest = z.infer<typeof ChatMessageCreateRequestSchema>;
