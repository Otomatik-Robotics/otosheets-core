/**
 * The Income reporting contract — every invoice ISSUED in a window, and the
 * figures over that same window.
 *
 * The window predicate is deliberately the BAS one (basReporting/inputs.pg.ts):
 * SENT/PARTIAL/OVERDUE/PAID, no drafts, no voids, no quotes, no recurring
 * templates and no payment links. That is what makes `gstOnIssued` label 1A
 * for the same window rather than a second, nearly equal number.
 *
 * Money is dollars rounded to cents; every count is a whole number; dates are
 * exact `YYYY-MM-DD` strings.
 */

/** Derived from the money against the invoice and today, never stored. */
export type IncomeStatus = 'SENT' | 'PART_PAID' | 'PAID' | 'OVERDUE';

export const INCOME_STATUSES: readonly IncomeStatus[] = ['SENT', 'PART_PAID', 'PAID', 'OVERDUE'];

export interface IncomeScope {
    orgId: string;
    /** Inclusive YYYY-MM-DD bounds on the issue date — normally a BAS quarter. */
    dateFrom: string;
    dateTo: string;
    /** YYYY-MM-DD the OVERDUE derivation is measured against. */
    today: string;
}

export interface IncomeListParams extends IncomeScope {
    limit?: number;
    /** Keyset cursor from a previous page. */
    cursor?: IncomeCursor | null;
    /** Matches invoice number or client name, in the query. */
    search?: string;
    /** One derived status. */
    status?: IncomeStatus;
}

/** Keyset position: issue date then invoice id, both descending. */
export interface IncomeCursor {
    issueDate: string;
    invoiceId: string;
}

export interface IncomeInvoiceRow {
    invoiceId: string;
    invoiceNumber: string;
    clientId: string | null;
    clientName: string | null;
    issueDate: string;
    dueDate: string | null;
    status: IncomeStatus;
    /** The date the LAST payment landed, null when no payment is recorded. */
    paidDate: string | null;
    /** Issue date to paidDate, in days. Null while unpaid. */
    daysToPay: number | null;
    /** Only when the derived status is OVERDUE. */
    daysPastDue: number | null;
    paidAmount: number;
    gstAmount: number;
    totalAmount: number;
}

export interface IncomeListResult {
    items: IncomeInvoiceRow[];
    /** Position to resume from, or null on the last page. */
    nextCursor: IncomeCursor | null;
}

/**
 * The window's figures. Never narrowed by search or status: label 1A must not
 * move when somebody filters the table under it.
 */
export interface IncomeTotals {
    /** Σ totalAmount, GST inclusive — the projection. */
    invoiced: number;
    invoiceCount: number;
    /** Σ paidAmount against those invoices — the actual. */
    received: number;
    /** Invoices settled in full. */
    paidCount: number;
    /** Σ (total less paid) over the invoices not settled in full. */
    stillOwed: number;
    owedCount: number;
    /** Of the still owed, how many are past their due date. */
    overdueCount: number;
    /** Label 1A for this window. */
    gstOnIssued: number;
    /** Issue to last payment, averaged over the invoices settled in full. */
    averageDaysToPay: number | null;
}

export interface IncomeMonthRow {
    /** `2026-07` */
    month: string;
    invoiced: number;
    received: number;
}

export interface IncomeOwedByRow {
    clientId: string | null;
    clientName: string | null;
    amount: number;
    invoices: number;
    overdue: number;
}

/** Top N clients by amount owed, and one aggregate over everybody else. */
export interface IncomeOwedByResult {
    top: IncomeOwedByRow[];
    other: { clients: number; amount: number };
}
