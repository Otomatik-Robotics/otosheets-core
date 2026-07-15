import { z } from 'zod';

/** Who created a bank ↔ ledger link. Today only USER (explicit accept);
 *  AUTO is reserved for future auto-matching and is never written yet.
 *  Literal unions (not z.infer) so consumers with a different zod version
 *  still see plain strings in the published d.ts. */
export type MatchSource = 'AUTO' | 'USER';
export const MatchSourceSchema = z.enum(['AUTO', 'USER']);

export type MatchTargetType = 'INVOICE' | 'RECEIPT';
export const MatchTargetTypeSchema = z.enum(['INVOICE', 'RECEIPT']);

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

/** One page of unmatched-income rows (keyset pagination + total for the entry pill). */
export interface UnmatchedIncomePage {
    items: UnmatchedIncomeRow[];
    nextToken: string | null;
    /** Total rows matching the filters (not just this page). */
    totalCount: number;
}

/** A confirmed old credit no invoice explains — the unmatched-income view. */
export interface UnmatchedIncomeRow {
    txnId: string;
    source: 'statement' | 'feed';
    statementId: string | null;
    seq: number | null;
    accountId: string | null;
    txnDate: string | null;
    description: string | null;
    amountCents: number;
    /** Current (machine-assigned) category — human-touched rows are filtered out. */
    category: string | null;
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
