"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReceiptCreateRequestSchema = exports.ReceiptStoredSchema = void 0;
const zod_1 = require("zod");
exports.ReceiptStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    sk: zod_1.z.string(),
    receiptId: zod_1.z.string(),
    createdBy: zod_1.z.string(),
    s3Key: zod_1.z.string().nullish(),
    contentHash: zod_1.z.string().nullish(),
    status: zod_1.z.string().default('PROCESSED'),
    vendorName: zod_1.z.string().nullish(),
    totalAmount: zod_1.z.number().nullish(),
    taxAmount: zod_1.z.number().nullish(),
    gstAmount: zod_1.z.number().nullish(),
    exGstAmount: zod_1.z.number().nullish(),
    date: zod_1.z.string().nullish(),
    category: zod_1.z.string().default('UNCATEGORIZED'),
    description: zod_1.z.string().nullish(),
    aiRiskLevel: zod_1.z.string().nullish(),
    isDeductible: zod_1.z.boolean().nullish(),
    aiWarning: zod_1.z.string().nullish(),
    isFuelReceipt: zod_1.z.boolean().default(false),
    businessPercent: zod_1.z.number().default(100),
    businessAmount: zod_1.z.number().nullish(),
    ruleApplied: zod_1.z.boolean().default(false),
    duplicateOf: zod_1.z.string().nullish(),
    possibleDuplicateOf: zod_1.z.string().nullish(),
    dateSk: zod_1.z.string().nullish(),
    createdAt: zod_1.z.string(),
});
exports.ReceiptCreateRequestSchema = zod_1.z.object({
    s3Key: zod_1.z.string().nullish(),
    vendorName: zod_1.z.string().nullish(),
    totalAmount: zod_1.z.number().nullish(),
    taxAmount: zod_1.z.number().nullish(),
    gstAmount: zod_1.z.number().nullish(),
    exGstAmount: zod_1.z.number().nullish(),
    date: zod_1.z.string().nullish(),
    category: zod_1.z.string().optional(),
    description: zod_1.z.string().nullish(),
    isDeductible: zod_1.z.boolean().nullish(),
    isFuelReceipt: zod_1.z.boolean().optional(),
    businessPercent: zod_1.z.number().optional(),
    businessAmount: zod_1.z.number().nullish(),
});
//# sourceMappingURL=schema.js.map