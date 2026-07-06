import { describe, it, expect } from 'vitest';
import { composeInvoiceSummary, type InvoiceSummaryBucket } from './summary';

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
