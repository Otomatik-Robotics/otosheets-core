import { describe, it, expect } from 'vitest';
import { composeInvoiceSummary, composeInvoiceTotals, type InvoiceSummaryBucket } from './summary';

const bucket = (b: Partial<InvoiceSummaryBucket> & { status: string }): InvoiceSummaryBucket => ({
    isPastDue: false,
    count: 1,
    totalAmount: 0,
    paidAmount: 0,
    ...b,
});

describe('composeInvoiceSummary', () => {
    it('returns all zeroes for no buckets', () => {
        const s = composeInvoiceSummary([]);
        expect(s).toEqual({
            outstanding: { amount: 0, count: 0 },
            overdue: { amount: 0, count: 0 },
            awaiting: { amount: 0, count: 0 },
            draft: { amount: 0, count: 0 },
        });
    });

    it('counts a SENT, not-past-due invoice as awaiting (owed = total - paid)', () => {
        const s = composeInvoiceSummary([
            bucket({ status: 'SENT', isPastDue: false, count: 1, totalAmount: 100, paidAmount: 0 }),
        ]);
        expect(s.awaiting).toEqual({ amount: 100, count: 1 });
        expect(s.overdue).toEqual({ amount: 0, count: 0 });
        expect(s.outstanding).toEqual({ amount: 100, count: 1 });
    });

    it('counts a SENT-but-past-due invoice as overdue (derived, not stored)', () => {
        const s = composeInvoiceSummary([
            bucket({ status: 'SENT', isPastDue: true, count: 1, totalAmount: 200, paidAmount: 0 }),
        ]);
        expect(s.overdue).toEqual({ amount: 200, count: 1 });
        expect(s.awaiting).toEqual({ amount: 0, count: 0 });
    });

    it('treats a stored OVERDUE status as overdue even if not flagged past due', () => {
        const s = composeInvoiceSummary([
            bucket({ status: 'OVERDUE', isPastDue: false, count: 1, totalAmount: 50, paidAmount: 0 }),
        ]);
        expect(s.overdue).toEqual({ amount: 50, count: 1 });
    });

    it('uses the owed remainder for PARTIAL invoices', () => {
        const s = composeInvoiceSummary([
            bucket({ status: 'PARTIAL', isPastDue: false, count: 1, totalAmount: 1000, paidAmount: 400 }),
        ]);
        expect(s.awaiting).toEqual({ amount: 600, count: 1 });
        expect(s.outstanding).toEqual({ amount: 600, count: 1 });
    });

    it('counts DRAFT by face value and never as outstanding', () => {
        const s = composeInvoiceSummary([
            bucket({ status: 'DRAFT', count: 2, totalAmount: 8370, paidAmount: 0 }),
        ]);
        expect(s.draft).toEqual({ amount: 8370, count: 2 });
        expect(s.outstanding).toEqual({ amount: 0, count: 0 });
    });

    it('excludes PAID and VOID from every figure', () => {
        const s = composeInvoiceSummary([
            bucket({ status: 'PAID', count: 3, totalAmount: 900, paidAmount: 900 }),
            bucket({ status: 'VOID', count: 1, totalAmount: 500, paidAmount: 0 }),
        ]);
        expect(s.outstanding).toEqual({ amount: 0, count: 0 });
        expect(s.draft).toEqual({ amount: 0, count: 0 });
    });

    it('keeps outstanding = overdue + awaiting across a mixed book', () => {
        const s = composeInvoiceSummary([
            bucket({ status: 'SENT', isPastDue: false, count: 7, totalAmount: 18922, paidAmount: 0 }),
            bucket({ status: 'OVERDUE', isPastDue: true, count: 3, totalAmount: 13988, paidAmount: 0 }),
            bucket({ status: 'DRAFT', count: 5, totalAmount: 8370, paidAmount: 0 }),
            bucket({ status: 'PAID', count: 5, totalAmount: 5000, paidAmount: 5000 }),
        ]);
        expect(s.awaiting).toEqual({ amount: 18922, count: 7 });
        expect(s.overdue).toEqual({ amount: 13988, count: 3 });
        expect(s.draft).toEqual({ amount: 8370, count: 5 });
        expect(s.outstanding.amount).toBe(s.overdue.amount + s.awaiting.amount);
        expect(s.outstanding.count).toBe(s.overdue.count + s.awaiting.count);
        expect(s.outstanding).toEqual({ amount: 32910, count: 10 });
    });

    it('rounds money to cents (no float drift)', () => {
        const s = composeInvoiceSummary([
            bucket({ status: 'SENT', count: 1, totalAmount: 0.1, paidAmount: 0 }),
            bucket({ status: 'SENT', count: 1, totalAmount: 0.2, paidAmount: 0 }),
        ]);
        expect(s.outstanding.amount).toBe(0.3);
    });
});

describe('composeInvoiceTotals', () => {
    it('returns zeroes for no buckets', () => {
        expect(composeInvoiceTotals([])).toEqual({
            count: 0, invoiced: 0, paid: 0, outstanding: 0, voided: 0,
        });
    });

    it('sums the whole set, not one status', () => {
        const t = composeInvoiceTotals([
            bucket({ status: 'PAID', count: 2, totalAmount: 500, paidAmount: 500 }),
            bucket({ status: 'SENT', count: 1, totalAmount: 300, paidAmount: 100 }),
            bucket({ status: 'DRAFT', count: 1, totalAmount: 60, paidAmount: 0 }),
        ]);
        expect(t.count).toBe(4);
        expect(t.invoiced).toBe(860);
        expect(t.paid).toBe(600);
    });

    // A cancelled invoice is not money you billed. Folding it into `invoiced`
    // overstates the figure, so it is counted and reported separately.
    it('keeps VOID out of invoiced and paid, but counts it', () => {
        const t = composeInvoiceTotals([
            bucket({ status: 'SENT', count: 1, totalAmount: 100, paidAmount: 0 }),
            bucket({ status: 'VOID', count: 1, totalAmount: 110, paidAmount: 0 }),
        ]);
        expect(t.invoiced).toBe(100);
        expect(t.voided).toBe(110);
        expect(t.count).toBe(2);
    });

    it('outstanding covers open invoices only, never drafts or paid', () => {
        const t = composeInvoiceTotals([
            bucket({ status: 'SENT', count: 1, totalAmount: 300, paidAmount: 100 }),
            bucket({ status: 'PAID', count: 1, totalAmount: 500, paidAmount: 500 }),
            bucket({ status: 'DRAFT', count: 1, totalAmount: 60, paidAmount: 0 }),
        ]);
        expect(t.outstanding).toBe(200);
    });

    it('agrees with composeInvoiceSummary on what is outstanding', () => {
        const buckets = [
            bucket({ status: 'SENT', isPastDue: true, count: 2, totalAmount: 400, paidAmount: 50 }),
            bucket({ status: 'PARTIAL', count: 1, totalAmount: 200, paidAmount: 120 }),
            bucket({ status: 'VOID', count: 1, totalAmount: 999, paidAmount: 0 }),
        ];
        expect(composeInvoiceTotals(buckets).outstanding)
            .toBe(composeInvoiceSummary(buckets).outstanding.amount);
    });

    it('rounds money to cents', () => {
        const t = composeInvoiceTotals([
            bucket({ status: 'SENT', count: 3, totalAmount: 0.1 + 0.2, paidAmount: 0 }),
        ]);
        expect(t.invoiced).toBe(0.3);
    });
});
