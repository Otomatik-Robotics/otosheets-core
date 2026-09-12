import { z } from 'zod';
export const EmailScopeSchema = z.object({ orgId: z.string().min(1) });
export type EmailScope = z.infer<typeof EmailScopeSchema>;
export const InboundMessageContentSchema = z.object({
    sender: z.string().max(320), recipients: z.array(z.string().max(320)).max(100),
    subject: z.string().max(1000), body: z.string().max(100000),
    rawKey: z.string().max(1024), internetMessageId: z.string().max(1000).optional(),
    references: z.array(z.string().max(1000)).max(100),
    kind: z.enum(['human', 'automatic', 'bounce', 'verification', 'loop', 'rejected']),
    attachments: z.array(z.object({ attachmentId: z.string(), key: z.string(), filename: z.string().max(255), contentType: z.string().max(255), size: z.number().int().nonnegative() })).max(20),
    verificationUrl: z.string().url().optional(),
});
export type InboundMessageContent = z.infer<typeof InboundMessageContentSchema>;
