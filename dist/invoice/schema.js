"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvoiceCreateRequestSchema = exports.InvoiceStoredSchema = exports.InvoiceBaseSchema = exports.LineItemSchema = void 0;
const zod_1 = require("zod");
exports.LineItemSchema = zod_1.z.object({
    id: zod_1.z.string(),
    description: zod_1.z.string(),
    quantity: zod_1.z.number().default(1),
    unitPrice: zod_1.z.number().default(0),
    total: zod_1.z.number().default(0),
    sortOrder: zod_1.z.number().default(0),
});
exports.InvoiceBaseSchema = zod_1.z.object({
    invoiceId: zod_1.z.string(),
    invoiceNumber: zod_1.z.string(),
    clientId: zod_1.z.string().nullish(),
    clientSnapshot: zod_1.z.any(),
    date: zod_1.z.string(),
    dueDate: zod_1.z.string(),
    status: zod_1.z.string().default('DRAFT'),
    subtotal: zod_1.z.number().default(0),
    gstMode: zod_1.z.string().default('EXCLUSIVE'),
    gstAmount: zod_1.z.number().default(0),
    totalAmount: zod_1.z.number().default(0),
    taxRate: zod_1.z.number().nullish(),
    taxLabel: zod_1.z.string().nullish(),
    paidAmount: zod_1.z.number().default(0),
    notes: zod_1.z.string().nullish(),
    items: zod_1.z.array(exports.LineItemSchema).default([]),
    isRecurring: zod_1.z.boolean().default(false),
    recurringConfig: zod_1.z.any().nullish(),
    isQuote: zod_1.z.boolean().default(false),
    isPaymentLink: zod_1.z.boolean().default(false),
    fromTimeEntries: zod_1.z.any().nullish(),
    followUpSequenceId: zod_1.z.string().nullish(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
exports.InvoiceStoredSchema = exports.InvoiceBaseSchema.extend({
    orgId: zod_1.z.string(),
    sk: zod_1.z.string(),
    createdBy: zod_1.z.string(),
    dueDateSk: zod_1.z.string().nullish(),
});
exports.InvoiceCreateRequestSchema = zod_1.z.object({
    invoiceNumber: zod_1.z.string(),
    clientId: zod_1.z.string().nullish(),
    clientSnapshot: zod_1.z.any(),
    date: zod_1.z.string(),
    dueDate: zod_1.z.string(),
    status: zod_1.z.string().optional(),
    subtotal: zod_1.z.number().optional(),
    gstMode: zod_1.z.string().optional(),
    gstAmount: zod_1.z.number().optional(),
    totalAmount: zod_1.z.number().optional(),
    taxRate: zod_1.z.number().nullish(),
    taxLabel: zod_1.z.string().nullish(),
    notes: zod_1.z.string().nullish(),
    items: zod_1.z.array(exports.LineItemSchema).default([]),
    isRecurring: zod_1.z.boolean().optional(),
    recurringConfig: zod_1.z.any().nullish(),
    isQuote: zod_1.z.boolean().optional(),
    isPaymentLink: zod_1.z.boolean().optional(),
    fromTimeEntries: zod_1.z.any().nullish(),
    followUpSequenceId: zod_1.z.string().nullish(),
});
//# sourceMappingURL=schema.js.map