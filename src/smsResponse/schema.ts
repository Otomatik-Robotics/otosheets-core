import { z } from 'zod';
export const SmsResponseScopeSchema = z.object({ orgId: z.string().min(1), businessProfileId: z.string().min(1) });
export type SmsResponseScope = z.infer<typeof SmsResponseScopeSchema>;
export const SmsRecipientSchema = z.object({ kind: z.enum(['lead', 'client', 'booking']), id: z.string().min(1), ownerId: z.string().min(1) });
export type SmsRecipient = z.infer<typeof SmsRecipientSchema>;
export const SmsResponseContextSchema = z.object({
    source: z.string().min(1).max(80), originId: z.string().min(1).max(200),
    recipient: SmsRecipientSchema, invoiceId: z.string().optional(), conversationId: z.string().optional(),
});
export type SmsResponseContext = z.infer<typeof SmsResponseContextSchema>;
