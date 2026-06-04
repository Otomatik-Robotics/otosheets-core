import { z } from 'zod';

export const LineItemSchema = z.object({
    id: z.string(),
    description: z.string(),
    quantity: z.number().default(1),
    unitPrice: z.number().default(0),
    total: z.number().default(0),
    sortOrder: z.number().default(0),
});
export type LineItem = z.infer<typeof LineItemSchema>;

export const InvoiceBaseSchema = z.object({
    invoiceId: z.string(),
    invoiceNumber: z.string(),
    clientId: z.string().nullish(),
    clientSnapshot: z.any(),
    date: z.string(),
    dueDate: z.string(),
    status: z.string().default('DRAFT'),
    subtotal: z.number().default(0),
    gstMode: z.string().default('EXCLUSIVE'),
    gstAmount: z.number().default(0),
    totalAmount: z.number().default(0),
    taxRate: z.number().nullish(),
    taxLabel: z.string().nullish(),
    paidAmount: z.number().default(0),
    notes: z.string().nullish(),
    items: z.array(LineItemSchema).default([]),
    isRecurring: z.boolean().default(false),
    recurringConfig: z.any().nullish(),
    isQuote: z.boolean().default(false),
    isPaymentLink: z.boolean().default(false),
    fromTimeEntries: z.any().nullish(),
    followUpSequenceId: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type InvoiceBase = z.infer<typeof InvoiceBaseSchema>;

export const InvoiceStoredSchema = InvoiceBaseSchema.extend({
    orgId: z.string(),
    sk: z.string(),
    createdBy: z.string(),
    dueDateSk: z.string().nullish(),
});
export type Invoice = z.infer<typeof InvoiceStoredSchema>;

export const InvoiceCreateRequestSchema = z.object({
    invoiceNumber: z.string(),
    clientId: z.string().nullish(),
    clientSnapshot: z.any(),
    date: z.string(),
    dueDate: z.string(),
    status: z.string().optional(),
    subtotal: z.number().optional(),
    gstMode: z.string().optional(),
    gstAmount: z.number().optional(),
    totalAmount: z.number().optional(),
    taxRate: z.number().nullish(),
    taxLabel: z.string().nullish(),
    notes: z.string().nullish(),
    items: z.array(LineItemSchema).default([]),
    isRecurring: z.boolean().optional(),
    recurringConfig: z.any().nullish(),
    isQuote: z.boolean().optional(),
    isPaymentLink: z.boolean().optional(),
    fromTimeEntries: z.any().nullish(),
    followUpSequenceId: z.string().nullish(),
});
export type InvoiceCreateRequest = z.infer<typeof InvoiceCreateRequestSchema>;
