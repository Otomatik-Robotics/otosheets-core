import { z } from 'zod';

/** Normalised 0–1 page coordinates of the source row on the statement PDF. */
export const BboxSchema = z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
});
export type Bbox = z.infer<typeof BboxSchema>;

export const CategorySourceSchema = z.enum(['RULE', 'AI', 'USER', 'ADVISOR']);
export type CategorySource = z.infer<typeof CategorySourceSchema>;

export const GstTreatmentSchema = z.enum(['GST', 'GST_FREE', 'INPUT_TAXED', 'NOT_REPORTABLE']);
export type GstTreatment = z.infer<typeof GstTreatmentSchema>;

/**
 * Deterministic money-flow class — sign + conservative description patterns,
 * derived by the pipeline (never the LLM). Independent of `category`, which
 * remains the richer LLM-assisted sub-classification.
 */
export const FlowClassSchema = z.enum(['INCOME', 'EXPENSE', 'TRANSFER', 'REFUND']);
export type FlowClass = z.infer<typeof FlowClassSchema>;

export const ReviewReasonSchema = z.enum([
    'CHAIN_BREAK', 'LOW_CONFIDENCE', 'UNPARSEABLE_AMOUNT', 'UNPARSEABLE_DATE', 'RULE_FLAG', 'UNCATEGORIZED',
]);
export type ReviewReason = z.infer<typeof ReviewReasonSchema>;

/**
 * One extracted bank-statement transaction. The parsed facts (date,
 * description, amounts, provenance) are the immutable extraction layer;
 * category/GST fields are the mutable annotation layer on top.
 * All money is integer cents; `amountCents` is signed (credit +, debit −).
 */
export const StatementTransactionSchema = z.object({
    txnId: z.string(),                  // '{statementId}#{seq5}' — deterministic
    statementId: z.string(),
    userId: z.string(),
    fy: z.string(),
    seq: z.number().int(),
    page: z.number().int().nullish(),
    rowIndex: z.number().int().nullish(),
    bbox: BboxSchema.nullish(),
    rawText: z.string().nullish(),
    txnDate: z.string().nullish(),      // YYYY-MM-DD
    description: z.string().nullish(),
    amountCents: z.number().int(),
    direction: z.enum(['DEBIT', 'CREDIT']).nullish(),
    balanceCents: z.number().int().nullish(),
    chainOk: z.boolean().nullish(),
    verificationFlags: z.array(z.string()).nullish(),
    flowClass: FlowClassSchema.nullish(),  // null on pre-column rows until reprocess
    // Cross-statement reconciliation layer: set at ingest, both null for
    // ordinary rows. A duplicate row (same account, same date/amount/description
    // already ingested by an overlapping statement) is excluded from every
    // summary; a transfer pair id ties the two legs of an internal transfer
    // across accounts (the debit leg's txnId is the shared id).
    duplicateOfTxnId: z.string().nullish(),
    transferPairId: z.string().nullish(),
    // Bank ↔ ledger matching layer — a user-accepted link from this row to the
    // business ledger. Only written on explicit accept (matchSource USER; AUTO
    // reserved for future auto-matching). Reprocessing never clears these.
    matchedInvoiceId: z.string().nullish(),
    matchedReceiptId: z.string().nullish(),
    matchSource: z.enum(['AUTO', 'USER']).nullish(),
    category: z.string().nullish(),
    categorySource: CategorySourceSchema.nullish(),
    categoryConfidence: z.number().min(0).max(1).nullish(),
    gstTreatment: GstTreatmentSchema.nullish(),
    gstAmountCents: z.number().int().nullish(),
    reviewReason: z.string().nullish(),
    reviewStatus: z.enum(['PENDING', 'CONFIRMED']),
    confirmedBy: z.string().nullish(),
    confirmedAt: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string().nullish(),
});
export type StatementTransaction = z.infer<typeof StatementTransactionSchema>;

/** Categorisation patch — the only mutable fields on a transaction. */
export const StatementTransactionCategoryPatchSchema = z.object({
    category: z.string().nullish(),
    categorySource: CategorySourceSchema,
    categoryConfidence: z.number().min(0).max(1).nullish(),
    gstTreatment: GstTreatmentSchema.nullish(),
    gstAmountCents: z.number().int().nullish(),
    confirmedBy: z.string().nullish(),
});
export type StatementTransactionCategoryPatch = z.infer<typeof StatementTransactionCategoryPatchSchema>;
