import { z } from 'zod';

// ─── Legacy Dynamo shapes (deprecated — the statements domain is born in
//     Postgres; these remain only until the last Dynamo consumer is deleted) ───

export const StatementBaseSchema = z.object({
    statementId: z.string(),
    fy: z.string(),
    fileName: z.string(),
    fileType: z.string().nullish(),
    s3Key: z.string(),
    createdAt: z.string(),
});
export type StatementBase = z.infer<typeof StatementBaseSchema>;

export const StatementStoredSchema = StatementBaseSchema.extend({
    userId: z.string(),
    sk: z.string(),
    organizationId: z.string().nullish(),
    businessProfileId: z.string().nullish(),   // profile scope (nullable — guest uploads have no org)
});
export type Statement = z.infer<typeof StatementStoredSchema>;

export const StatementCreateRequestSchema = z.object({
    fy: z.string(),
    fileName: z.string(),
    fileType: z.string().nullish(),
    s3Key: z.string(),
    organizationId: z.string().nullish(),
});
export type StatementCreateRequest = z.infer<typeof StatementCreateRequestSchema>;

// ─── Postgres statements domain ───

export const STATEMENT_STATUSES = [
    'UPLOADED', 'EXTRACTING', 'VERIFYING', 'CATEGORISING',
    'VERIFIED', 'NEEDS_REVIEW', 'CATEGORISED',
    'DUPLICATE', 'EXTRACTION_FAILED', 'UNPARSEABLE',
] as const;
export const StatementStatusSchema = z.enum(STATEMENT_STATUSES);
export type StatementStatus = z.infer<typeof StatementStatusSchema>;

export const StatementVerificationSchema = z.object({
    mode: z.enum(['CHAIN', 'RECONCILE_ONLY']),
    chainOk: z.boolean().nullish(),
    chainBreakCount: z.number().int().nullish(),
    openingBalanceCents: z.number().int().nullish(),
    closingBalanceCents: z.number().int().nullish(),
    totalCreditsCents: z.number().int().nullish(),
    totalDebitsCents: z.number().int().nullish(),
    reconciled: z.boolean().nullish(),
    discrepancyCents: z.number().int().nullish(),
    pageContinuityOk: z.boolean().nullish(),
    signConventionCorrected: z.boolean().nullish(),
    breaks: z.array(z.object({
        seq: z.number().int(),
        expectedCents: z.number().int().nullish(),
        actualCents: z.number().int().nullish(),
    })).max(50).nullish(),
    // Deterministic money-flow totals (sign + pattern derived, LLM-independent)
    // and the reconciliation invariant Σflows == credits − debits.
    flowTotals: z.object({
        incomeCents: z.number().int(),
        expenseCents: z.number().int(),      // positive number (money out)
        transferInCents: z.number().int(),
        transferOutCents: z.number().int(),  // positive number
        refundCents: z.number().int(),
    }).nullish(),
    flowsReconciled: z.boolean().nullish(),
    // Cross-statement continuity for the statement's account, evaluated at
    // processing time against the account's other statements: does this
    // statement's opening balance equal the adjacent prior statement's closing,
    // and does its period overlap any sibling? `ok` is false on an overlap or
    // an opening/closing mismatch (either sends the statement to review).
    continuity: z.object({
        accountId: z.string().nullish(),
        priorStatementId: z.string().nullish(),
        priorClosingBalanceCents: z.number().int().nullish(),
        openingMatchesPriorClosing: z.boolean().nullish(),
        /** Calendar days between the prior statement's periodEnd and this periodStart (1 = contiguous). */
        gapDaysFromPrior: z.number().int().nullish(),
        overlapStatementIds: z.array(z.string()).max(20).nullish(),
        /** Rows of this statement marked duplicate_of_txn_id at ingest. */
        duplicateTxnCount: z.number().int().nullish(),
        ok: z.boolean().nullish(),
    }).nullish(),
});
export type StatementVerification = z.infer<typeof StatementVerificationSchema>;

// Provenance of a resolved statement period.
export const STATEMENT_PERIOD_SOURCES = ['printed', 'derived', 'user'] as const;
export const StatementPeriodSourceSchema = z.enum(STATEMENT_PERIOD_SOURCES);
export type StatementPeriodSource = z.infer<typeof StatementPeriodSourceSchema>;

// The two candidate ranges surfaced when the printed period and the derived
// row-date range disagree (the disambiguation the user resolves). ISO YYYY-MM-DD.
export const StatementPeriodConflictSchema = z.object({
    rowStart: z.string(),
    rowEnd: z.string(),
    statementStart: z.string(),
    statementEnd: z.string(),
});
export type StatementPeriodConflict = z.infer<typeof StatementPeriodConflictSchema>;

export const StatementRecordSchema = z.object({
    statementId: z.string(),
    userId: z.string(),                 // Cognito sub or 'prospect#{prospectId}'
    organizationId: z.string().nullish(),
    fy: z.string(),
    fileName: z.string().nullish(),
    fileType: z.string().nullish(),
    s3Key: z.string(),
    status: StatementStatusSchema,
    contentHash: z.string().nullish(),
    extractionVersion: z.number().int(),
    textractJobId: z.string().nullish(),
    bankName: z.string().nullish(),
    accountLast4: z.string().nullish(),
    // Stable account identity (bank_accounts.account_id) behind the two
    // denormalised strings above. Null when undetected or for guest uploads.
    accountId: z.string().nullish(),
    periodStart: z.string().nullish(),  // YYYY-MM-DD
    periodEnd: z.string().nullish(),
    periodSource: StatementPeriodSourceSchema.nullish(),
    periodConflict: StatementPeriodConflictSchema.nullish(),
    verification: StatementVerificationSchema.nullish(),
    txnCount: z.number().int().nullish(),
    needsReviewCount: z.number().int().nullish(),
    confirmedCount: z.number().int().nullish(),
    // How many times the processing worker has picked this statement up (SQS
    // ApproximateReceiveCount). >1 means a prior attempt threw and it's being
    // retried — surfaced as "Retry N/…" in the processing-queue UI. Null/1 on
    // a clean first pass.
    processingAttempt: z.number().int().nullish(),
    errorMessage: z.string().nullish(),
    duplicateOfStatementId: z.string().nullish(),
    createdAt: z.string(),
    processedAt: z.string().nullish(),
    updatedAt: z.string(),
});
export type StatementRecord = z.infer<typeof StatementRecordSchema>;

export const StatementCreateSchema = z.object({
    statementId: z.string(),
    userId: z.string(),
    organizationId: z.string().nullish(),
    fy: z.string(),
    fileName: z.string().nullish(),
    fileType: z.string().nullish(),
    s3Key: z.string(),
});
export type StatementCreate = z.infer<typeof StatementCreateSchema>;
