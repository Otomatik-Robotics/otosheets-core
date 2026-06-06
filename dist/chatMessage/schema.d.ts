import { z } from 'zod';
export declare const ChatAttachmentSchema: z.ZodObject<{
    attachmentId: z.ZodString;
    type: z.ZodString;
    fileName: z.ZodString;
    fileType: z.ZodString;
    fileSize: z.ZodNumber;
    s3Key: z.ZodString;
    duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    attachmentId: z.ZodString;
    type: z.ZodString;
    fileName: z.ZodString;
    fileType: z.ZodString;
    fileSize: z.ZodNumber;
    s3Key: z.ZodString;
    duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    attachmentId: z.ZodString;
    type: z.ZodString;
    fileName: z.ZodString;
    fileType: z.ZodString;
    fileSize: z.ZodNumber;
    s3Key: z.ZodString;
    duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, z.ZodTypeAny, "passthrough">>;
export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;
export declare const ChatMessageStoredSchema: z.ZodObject<{
    conversationId: z.ZodString;
    messageId: z.ZodString;
    senderId: z.ZodString;
    senderName: z.ZodString;
    content: z.ZodString;
    timestamp: z.ZodString;
    attachments: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        attachmentId: z.ZodString;
        type: z.ZodString;
        fileName: z.ZodString;
        fileType: z.ZodString;
        fileSize: z.ZodNumber;
        s3Key: z.ZodString;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        attachmentId: z.ZodString;
        type: z.ZodString;
        fileName: z.ZodString;
        fileType: z.ZodString;
        fileSize: z.ZodNumber;
        s3Key: z.ZodString;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        attachmentId: z.ZodString;
        type: z.ZodString;
        fileName: z.ZodString;
        fileType: z.ZodString;
        fileSize: z.ZodNumber;
        s3Key: z.ZodString;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>>;
    status: z.ZodDefault<z.ZodString>;
    encryptedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    status: string;
    senderId: string;
    conversationId: string;
    messageId: string;
    senderName: string;
    content: string;
    timestamp: string;
    attachments?: z.objectOutputType<{
        attachmentId: z.ZodString;
        type: z.ZodString;
        fileName: z.ZodString;
        fileType: z.ZodString;
        fileSize: z.ZodNumber;
        s3Key: z.ZodString;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">[] | null | undefined;
    encryptedAt?: string | null | undefined;
}, {
    senderId: string;
    conversationId: string;
    messageId: string;
    senderName: string;
    content: string;
    timestamp: string;
    status?: string | undefined;
    attachments?: z.objectInputType<{
        attachmentId: z.ZodString;
        type: z.ZodString;
        fileName: z.ZodString;
        fileType: z.ZodString;
        fileSize: z.ZodNumber;
        s3Key: z.ZodString;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">[] | null | undefined;
    encryptedAt?: string | null | undefined;
}>;
export type ChatMessage = z.infer<typeof ChatMessageStoredSchema>;
export declare const ChatMessageCreateRequestSchema: z.ZodObject<{
    content: z.ZodString;
    attachments: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        attachmentId: z.ZodString;
        type: z.ZodString;
        fileName: z.ZodString;
        fileType: z.ZodString;
        fileSize: z.ZodNumber;
        s3Key: z.ZodString;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        attachmentId: z.ZodString;
        type: z.ZodString;
        fileName: z.ZodString;
        fileType: z.ZodString;
        fileSize: z.ZodNumber;
        s3Key: z.ZodString;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        attachmentId: z.ZodString;
        type: z.ZodString;
        fileName: z.ZodString;
        fileType: z.ZodString;
        fileSize: z.ZodNumber;
        s3Key: z.ZodString;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>>;
}, "strip", z.ZodTypeAny, {
    content: string;
    attachments?: z.objectOutputType<{
        attachmentId: z.ZodString;
        type: z.ZodString;
        fileName: z.ZodString;
        fileType: z.ZodString;
        fileSize: z.ZodNumber;
        s3Key: z.ZodString;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">[] | null | undefined;
}, {
    content: string;
    attachments?: z.objectInputType<{
        attachmentId: z.ZodString;
        type: z.ZodString;
        fileName: z.ZodString;
        fileType: z.ZodString;
        fileSize: z.ZodNumber;
        s3Key: z.ZodString;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">[] | null | undefined;
}>;
export type ChatMessageCreateRequest = z.infer<typeof ChatMessageCreateRequestSchema>;
//# sourceMappingURL=schema.d.ts.map