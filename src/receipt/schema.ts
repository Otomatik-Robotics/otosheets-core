import { z } from 'zod';

export const ReceiptStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(),
    receiptId: z.string(),
    createdBy: z.string(),
    s3Key: z.string().nullish(),
    contentHash: z.string().nullish(),
    status: z.string().default('PROCESSED'),
    vendorName: z.string().nullish(),
    totalAmount: z.number().nullish(),
    taxAmount: z.number().nullish(),
    gstAmount: z.number().nullish(),
    exGstAmount: z.number().nullish(),
    date: z.string().nullish(),
    category: z.string().default('UNCATEGORIZED'),
    description: z.string().nullish(),
    aiRiskLevel: z.string().nullish(),
    isDeductible: z.boolean().nullish(),
    aiWarning: z.string().nullish(),
    isFuelReceipt: z.boolean().default(false),
    businessPercent: z.number().default(100),
    businessAmount: z.number().nullish(),
    ruleApplied: z.boolean().default(false),
    duplicateOf: z.string().nullish(),
    possibleDuplicateOf: z.string().nullish(),
    dateSk: z.string().nullish(),
    createdAt: z.string(),
});
export type Receipt = z.infer<typeof ReceiptStoredSchema>;

export const ReceiptCreateRequestSchema = z.object({
    s3Key: z.string().nullish(),
    vendorName: z.string().nullish(),
    totalAmount: z.number().nullish(),
    taxAmount: z.number().nullish(),
    gstAmount: z.number().nullish(),
    exGstAmount: z.number().nullish(),
    date: z.string().nullish(),
    category: z.string().optional(),
    description: z.string().nullish(),
    isDeductible: z.boolean().nullish(),
    isFuelReceipt: z.boolean().optional(),
    businessPercent: z.number().optional(),
    businessAmount: z.number().nullish(),
});
export type ReceiptCreateRequest = z.infer<typeof ReceiptCreateRequestSchema>;
