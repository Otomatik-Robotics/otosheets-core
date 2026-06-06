"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvoicePaymentStoredSchema = exports.InvoicePaymentBaseSchema = void 0;
const zod_1 = require("zod");
exports.InvoicePaymentBaseSchema = zod_1.z.object({
    paymentId: zod_1.z.string(),
    invoiceId: zod_1.z.string(),
    amount: zod_1.z.number(),
    method: zod_1.z.string(),
    date: zod_1.z.string(),
    note: zod_1.z.string().nullish(),
    stripePaymentIntentId: zod_1.z.string().nullish(),
    createdAt: zod_1.z.string(),
});
exports.InvoicePaymentStoredSchema = exports.InvoicePaymentBaseSchema.extend({
    orgId: zod_1.z.string(),
    sk: zod_1.z.string(),
    userId: zod_1.z.string(),
});
//# sourceMappingURL=schema.js.map