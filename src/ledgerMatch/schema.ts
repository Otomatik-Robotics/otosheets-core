import { z } from 'zod';

/** Who created a bank ↔ ledger link. Today only USER (explicit accept);
 *  AUTO is reserved for future auto-matching and is never written yet. */
export const MatchSourceSchema = z.enum(['AUTO', 'USER']);
export type MatchSource = z.infer<typeof MatchSourceSchema>;

export const MatchTargetTypeSchema = z.enum(['INVOICE', 'RECEIPT']);
export type MatchTargetType = z.infer<typeof MatchTargetTypeSchema>;

/** Slim bank-money row (statement- or feed-sourced) fed to the matching engine. */
export interface MatchableLedgerRow {
    txnId: string;
    source: 'statement' | 'feed';
    statementId: string | null;      // statement rows only
    accountId: string | null;        // feed rows only (statements resolve via the statement)
    seq: number | null;              // statement rows only — the PATCH/accept addressing unit
    txnDate: string | null;          // YYYY-MM-DD
    description: string | null;
    amountCents: number;             // signed: credit +, debit −
    direction: 'DEBIT' | 'CREDIT' | null;
    flowClass: string | null;        // statement rows only
    duplicateOfTxnId: string | null;
    transferPairId: string | null;   // statement rows only
    matchedInvoiceId: string | null;
    matchedReceiptId: string | null;
}

/** An invoice still owed money — a candidate for a bank CREDIT. Money in integer cents. */
export interface OpenInvoiceForMatching {
    invoiceId: string;
    invoiceNumber: string | null;
    clientId: string | null;
    clientName: string | null;
    totalCents: number;
    paidCents: number;
    amountDueCents: number;          // totalCents − paidCents
    issueDate: string | null;        // invoices.date ('issue_date')
    status: string;
}

/** A receipt no bank row links to yet — a candidate for a bank DEBIT. */
export interface UnlinkedReceiptForMatching {
    receiptId: string;
    vendorName: string | null;
    totalCents: number;              // positive
    receiptDate: string | null;      // receipts.date ('receipt_date')
}

export interface MatchRejectionRow {
    txnId: string;
    targetType: MatchTargetType;
    targetId: string;
}

/** A confirmed old credit no invoice explains — the Statements-page watchlist. */
export interface UnmatchedIncomeRow {
    txnId: string;
    source: 'statement' | 'feed';
    statementId: string | null;
    seq: number | null;
    accountId: string | null;
    txnDate: string | null;
    description: string | null;
    amountCents: number;
    /** Display label of the money's account, e.g. 'CBA •• 4021'. */
    accountLabel: string | null;
}

/** Live display facts for an already-matched invoice (chip rendering — never snapshotted). */
export interface InvoiceChipInfo {
    invoiceId: string;
    invoiceNumber: string | null;
    clientName: string | null;
    status: string;
    totalCents: number;
}

/** Live display facts for an already-matched receipt. */
export interface ReceiptChipInfo {
    receiptId: string;
    vendorName: string | null;
    totalCents: number;
    receiptDate: string | null;
}

/** Per-invoice deposit evidence for the "no bank deposit found" advisory. */
export interface InvoiceDepositCheck {
    invoiceId: string;
    /** A bank row (either source) is linked to this invoice. */
    bankMatched: boolean;
    /** Latest recorded BANK_TRANSFER payment date (YYYY-MM-DD), if any. */
    lastBankTransferPaymentDate: string | null;
}
