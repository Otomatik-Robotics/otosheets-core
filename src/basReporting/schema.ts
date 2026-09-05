/**
 * The BAS reporting contract — the inputs one quarter's confidence score is
 * folded from, and the score itself. Types only: `inputs.pg.ts` produces
 * BasInputs from Postgres, `confidence.ts` folds them store-free.
 *
 * All money is dollars rounded to cents; every count is a whole number.
 */

export interface BasInputsScope {
    orgId: string;
    /** Inclusive YYYY-MM-DD bounds — normally a BAS quarter (see basPeriod/period.ts). */
    dateFrom: string;
    dateTo: string;
}

export interface BasReceiptExceptions {
    possibleDuplicate: number;
    extractionFailed: number;
    highRisk: number;
    uncategorised: number;
    noAmount: number;
}

export interface BasInputs {
    window: { dateFrom: string; dateTo: string };
    invoices: {
        /** Real invoices issued in the window: SENT/PARTIAL/OVERDUE/PAID, not quotes, recurring templates or payment links. */
        count: number;
        gstCollected: number;
        salesExGst: number;
        /** Of those, PAID or PARTIAL. */
        paidCount: number;
        /** Paid invoices no bank credit is matched to and Stripe did not collect — money the books say arrived but the bank cannot show. */
        paidWithoutBankCredit: number;
        /** The first 200 of them, newest issue date first. */
        paidWithoutBankCreditIds: string[];
    };
    receipts: {
        /** Receipts dated in the window, DUPLICATE/ARCHIVED excluded. */
        count: number;
        /** Business share of the GST on every receipt, capital purchases included. */
        gstPaid: number;
        /**
         * Business share of the GST on receipts that became an asset. The BAS
         * reports capital purchases at G10 and the rest at G11, so the split
         * has to be measured; deriving it from the register's business-use
         * share is only right when that matches the receipt's.
         */
        capitalGstPaid: number;
        /** Receipts that did NOT become an asset, the set expensesExGst sums. */
        nonCapitalCount: number;
        /** Business share of the ex-GST amount on receipts that did NOT become an asset. */
        expensesExGst: number;
        /** Business share of the ex-GST amount on receipts that DID become an asset. */
        capitalExGst: number;
        /** Not (opened AND category confirmed AND outside the exception set). */
        unreviewed: number;
        notOpened: number;
        categoryUnconfirmed: number;
        /** Distinct receipts in at least one exception bucket. */
        inException: number;
        exception: BasReceiptExceptions;
    };
    trips: { count: number; km: number };
    bank: {
        /** At least one month of the window is covered by a statement or a live feed. */
        hasStatement: boolean;
        /** An ACTIVE bank_accounts row exists for the org. */
        feedActive: boolean;
        /** Calendar months overlapping the window. */
        monthsInWindow: number;
        monthsCovered: number;
        /** 'YYYY-MM' of every month nothing covers. */
        monthsMissing: string[];
        /**
         * Statements that cover the window: a period overlapping it, or at
         * least one transaction dated inside it. A statement whose printed
         * period could not be resolved still counts, because its rows do.
         */
        statements: number;
        /** Statement + feed rows dated in the window, duplicates and transfer legs excluded. */
        rowsTotal: number;
        /** Rows with no invoice/receipt link and no human-confirmed category. */
        unreconciledRows: number;
        /** Credits the unmatched-income predicate flags (ledgerMatch's single definition), in the window. */
        unmatchedCredits: number;
        unmatchedCreditsAmount: number;
    };
    assets: {
        /** ACTIVE assets. */
        count: number;
        /** ACTIVE assets with no first-used date — depreciation cannot start. */
        withoutFirstUse: number;
    };
}

export type BasReasonCode =
    | 'NO_STATEMENT'
    | 'INVOICES_UNATTRIBUTED'
    | 'MONTH_MISSING'
    | 'BANK_ROWS_UNRECONCILED'
    | 'CREDITS_UNMATCHED'
    | 'RECEIPTS_UNREVIEWED'
    | 'ASSETS_NO_FIRST_USE';

/** One thing standing between the quarter and a 100 score. */
export interface BasReason {
    code: BasReasonCode;
    count: number;
    detail?: string;
}

export type BasConfidenceScore = 50 | 75 | 90 | 100;

export interface BasConfidence {
    score: BasConfidenceScore;
    /** In ladder order — the first entry is what the score is stuck on. Empty at 100. */
    reasons: BasReason[];
}
