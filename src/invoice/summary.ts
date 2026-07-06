/**
 * Invoice summary aggregate — the numbers behind the Invoices KPI band
 * (outstanding / overdue / awaiting / draft). Computed live from the store,
 * never a maintained counter: Postgres does it in one GROUP BY, and the Dynamo
 * fallback folds a bounded per-org read through the same pure compose function.
 *
 * "Overdue" is derived, not trusted from the stored status: an invoice is
 * overdue if it is open (SENT/PARTIAL/OVERDUE) and either the cron already
 * flipped it to OVERDUE or its due date is in the past. This stays correct
 * between chase-cron runs, when a SENT invoice may sit past due.
 */

/** Statuses that represent money still owed to the business. */
export const OPEN_INVOICE_STATUSES = ['SENT', 'PARTIAL', 'OVERDUE'] as const;

/** One (status, past-due) group of invoices with rolled-up money + count. */
export interface InvoiceSummaryBucket {
    status: string;
    /** Whether this group's due date is before "today" (past due). */
    isPastDue: boolean;
    count: number;
    /** Σ totalAmount across the group. */
    totalAmount: number;
    /** Σ paidAmount across the group. */
    paidAmount: number;
}

/** A single card's figure: money + how many invoices contribute to it. */
export interface InvoiceSummaryFigure {
    amount: number;
    count: number;
}

/** The KPI-band payload for one org. `outstanding = overdue + awaiting`. */
export interface InvoiceSummary {
    /** Owed across all open invoices (overdue + awaiting). */
    outstanding: InvoiceSummaryFigure;
    /** Owed on open invoices that are past due (or cron-flipped OVERDUE). */
    overdue: InvoiceSummaryFigure;
    /** Owed on open invoices not yet past due. */
    awaiting: InvoiceSummaryFigure;
    /** Face value of unsent drafts (nothing owed yet, but cash held up). */
    draft: InvoiceSummaryFigure;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const add = (f: InvoiceSummaryFigure, amount: number, count: number): void => {
    f.amount += amount;
    f.count += count;
};

/** Is an open bucket effectively overdue? Stored status wins; else past-due. */
function bucketIsOverdue(bucket: InvoiceSummaryBucket): boolean {
    return bucket.status === 'OVERDUE' || bucket.isPastDue;
}

/**
 * Fold raw (status, past-due) buckets into the KPI-band figures. Pure — both
 * the Postgres GROUP BY and the Dynamo scan produce buckets and call this, so
 * the bucketing rules live and are tested in exactly one place.
 */
export function composeInvoiceSummary(buckets: InvoiceSummaryBucket[]): InvoiceSummary {
    const outstanding: InvoiceSummaryFigure = { amount: 0, count: 0 };
    const overdue: InvoiceSummaryFigure = { amount: 0, count: 0 };
    const awaiting: InvoiceSummaryFigure = { amount: 0, count: 0 };
    const draft: InvoiceSummaryFigure = { amount: 0, count: 0 };

    for (const b of buckets) {
        if (b.count === 0) continue;
        if (b.status === 'DRAFT') {
            add(draft, b.totalAmount, b.count);
            continue;
        }
        if ((OPEN_INVOICE_STATUSES as readonly string[]).includes(b.status)) {
            const owed = b.totalAmount - b.paidAmount;
            add(outstanding, owed, b.count);
            if (bucketIsOverdue(b)) add(overdue, owed, b.count);
            else add(awaiting, owed, b.count);
        }
        // PAID / VOID / anything else: not owed, not draft — excluded.
    }

    for (const f of [outstanding, overdue, awaiting, draft]) f.amount = round2(f.amount);
    return { outstanding, overdue, awaiting, draft };
}
