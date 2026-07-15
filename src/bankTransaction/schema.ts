import { z } from 'zod';

export const BankCategorySourceSchema = z.enum(['RULE', 'AI', 'USER', 'ADVISOR']);
export type BankCategorySource = z.infer<typeof BankCategorySourceSchema>;

export const BankGstTreatmentSchema = z.enum(['GST', 'GST_FREE', 'INPUT_TAXED', 'NOT_REPORTABLE']);
export type BankGstTreatment = z.infer<typeof BankGstTreatmentSchema>;

/**
 * One transaction from a consented open-banking feed (Fiskil / CDR). The parsed
 * facts (date, description, amount, provider category) are the immutable
 * extraction layer written by sync; category/GST/review are the mutable
 * annotation layer — deliberately identical to StatementTransaction so the
 * reporting layer can treat statement-sourced and feed-sourced rows uniformly.
 * All money is integer cents; `amountCents` is signed (credit +, debit −).
 */
export const BankTransactionSchema = z.object({
    txnId: z.string(),                  // provider transaction id — deterministic PK
    accountId: z.string(),
    userId: z.string(),
    organizationId: z.string().nullish(),
    fy: z.string(),
    txnDate: z.string().nullish(),      // YYYY-MM-DD
    description: z.string().nullish(),
    amountCents: z.number().int(),
    direction: z.enum(['DEBIT', 'CREDIT']).nullish(),
    status: z.string().nullish(),       // POSTED | PENDING
    merchantName: z.string().nullish(),
    providerCategory: z.string().nullish(),
    // Set when a statement of the same (unified) account already ingested this
    // row — excluded from every summary (mirror of statement_transactions).
    duplicateOfTxnId: z.string().nullish(),
    // Bank ↔ ledger matching layer (mirrors StatementTransaction) — only
    // written on explicit user accept; sync upserts never touch these.
    matchedInvoiceId: z.string().nullish(),
    matchedReceiptId: z.string().nullish(),
    matchSource: z.enum(['AUTO', 'USER']).nullish(),
    raw: z.any().nullish(),
    category: z.string().nullish(),
    categorySource: BankCategorySourceSchema.nullish(),
    categoryConfidence: z.number().min(0).max(1).nullish(),
    gstTreatment: BankGstTreatmentSchema.nullish(),
    gstAmountCents: z.number().int().nullish(),
    reviewReason: z.string().nullish(),
    reviewStatus: z.enum(['PENDING', 'CONFIRMED']),
    confirmedBy: z.string().nullish(),
    confirmedAt: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string().nullish(),
});
export type BankTransaction = z.infer<typeof BankTransactionSchema>;

/** Categorisation patch — the only mutable fields on a transaction. */
export const BankTransactionCategoryPatchSchema = z.object({
    category: z.string().nullish(),
    categorySource: BankCategorySourceSchema,
    categoryConfidence: z.number().min(0).max(1).nullish(),
    gstTreatment: BankGstTreatmentSchema.nullish(),
    gstAmountCents: z.number().int().nullish(),
    confirmedBy: z.string().nullish(),
});
export type BankTransactionCategoryPatch = z.infer<typeof BankTransactionCategoryPatchSchema>;
