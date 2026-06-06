import { z } from 'zod';
export declare const InvoicePaymentBaseSchema: z.ZodObject<{
    paymentId: z.ZodString;
    invoiceId: z.ZodString;
    amount: z.ZodNumber;
    method: z.ZodString;
    date: z.ZodString;
    note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    stripePaymentIntentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    date: string;
    createdAt: string;
    invoiceId: string;
    paymentId: string;
    amount: number;
    method: string;
    note?: string | null | undefined;
    stripePaymentIntentId?: string | null | undefined;
}, {
    date: string;
    createdAt: string;
    invoiceId: string;
    paymentId: string;
    amount: number;
    method: string;
    note?: string | null | undefined;
    stripePaymentIntentId?: string | null | undefined;
}>;
export type InvoicePaymentBase = z.infer<typeof InvoicePaymentBaseSchema>;
export declare const InvoicePaymentStoredSchema: z.ZodObject<{
    paymentId: z.ZodString;
    invoiceId: z.ZodString;
    amount: z.ZodNumber;
    method: z.ZodString;
    date: z.ZodString;
    note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    stripePaymentIntentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    createdAt: z.ZodString;
} & {
    orgId: z.ZodString;
    sk: z.ZodString;
    userId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    userId: string;
    date: string;
    createdAt: string;
    orgId: string;
    invoiceId: string;
    sk: string;
    paymentId: string;
    amount: number;
    method: string;
    note?: string | null | undefined;
    stripePaymentIntentId?: string | null | undefined;
}, {
    userId: string;
    date: string;
    createdAt: string;
    orgId: string;
    invoiceId: string;
    sk: string;
    paymentId: string;
    amount: number;
    method: string;
    note?: string | null | undefined;
    stripePaymentIntentId?: string | null | undefined;
}>;
export type InvoicePayment = z.infer<typeof InvoicePaymentStoredSchema>;
//# sourceMappingURL=schema.d.ts.map