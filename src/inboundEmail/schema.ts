import { z } from 'zod';
export const EmailScopeSchema = z.object({ orgId: z.string().min(1) });
export type EmailScope = z.infer<typeof EmailScopeSchema>;
/**
 * Whether a forwarded email is a job enquiry. Only `job` opens a lead. `by`
 * says who decided: a rule (thread history, known client, sender pattern),
 * the model, or the owner overriding either from Channels.
 */
export const EmailTriageSchema = z.object({
    verdict: z.enum(['job', 'not_job']),
    reason: z.string().max(300),
    by: z.enum(['rule', 'model', 'owner']),
    at: z.string(),
});
export type EmailTriage = z.infer<typeof EmailTriageSchema>;
export const InboundMessageContentSchema = z.object({
    sender: z.string().max(320), recipients: z.array(z.string().max(320)).max(100),
    subject: z.string().max(1000), body: z.string().max(100000),
    /** Sanitised HTML of the same visible reply (allow-listed tags, no images, no styles); absent for text-only mail. */
    bodyHtml: z.string().max(200000).optional(),
    rawKey: z.string().max(1024), internetMessageId: z.string().max(1000).optional(),
    references: z.array(z.string().max(1000)).max(100),
    kind: z.enum(['human', 'automatic', 'bounce', 'verification', 'loop', 'rejected']),
    attachments: z.array(z.object({ attachmentId: z.string(), key: z.string(), filename: z.string().max(255), contentType: z.string().max(255), size: z.number().int().nonnegative() })).max(20),
    verificationUrl: z.string().url().optional(),
    triage: EmailTriageSchema.optional(),
});
export type InboundMessageContent = z.infer<typeof InboundMessageContentSchema>;
