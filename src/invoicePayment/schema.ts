import { z } from 'zod';

export const InvoicePaymentBaseSchema = z.object({
    paymentId: z.string(),
    invoiceId: z.string(),
    amount: z.number(),
    method: z.string(),
    date: z.string(),
    note: z.string().nullish(),
    stripePaymentIntentId: z.string().nullish(),
    createdAt: z.string(),
});
export type InvoicePaymentBase = z.infer<typeof InvoicePaymentBaseSchema>;

export const InvoicePaymentStoredSchema = InvoicePaymentBaseSchema.extend({
    orgId: z.string(),
    businessProfileId: z.string().nullish(),   // profile scope
    sk: z.string(),
    userId: z.string(),
});
export type InvoicePayment = z.infer<typeof InvoicePaymentStoredSchema>;
