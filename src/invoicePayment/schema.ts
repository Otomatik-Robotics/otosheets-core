import { z } from 'zod';

export const InvoicePaymentStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(),
    paymentId: z.string(),
    invoiceId: z.string(),
    userId: z.string(),
    amount: z.number(),
    method: z.string(),
    date: z.string(),
    note: z.string().nullish(),
    stripePaymentIntentId: z.string().nullish(),
    createdAt: z.string(),
});
export type InvoicePayment = z.infer<typeof InvoicePaymentStoredSchema>;
