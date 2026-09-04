import { describe, it, expect } from 'vitest';
import { composeConfidence, fewRowsThreshold } from './confidence';
import type { BasInputs } from './schema';

/** A quarter with everything reviewed, matched and covered — the 100 baseline; tests override what they break. */
function inputs(over: {
    invoices?: Partial<BasInputs['invoices']>;
    receipts?: Partial<BasInputs['receipts']>;
    bank?: Partial<BasInputs['bank']>;
    assets?: Partial<BasInputs['assets']>;
} = {}): BasInputs {
    return {
        window: { dateFrom: '2026-07-01', dateTo: '2026-09-30' },
        invoices: {
            count: 12, gstCollected: 2400, salesExGst: 24000, paidCount: 9,
            paidWithoutBankCredit: 0, paidWithoutBankCreditIds: [],
            ...over.invoices,
        },
        receipts: {
            count: 40, gstPaid: 610.5, expensesExGst: 6105, capitalExGst: 0,
            unreviewed: 0, notOpened: 0, categoryUnconfirmed: 0, inException: 0,
            exception: { possibleDuplicate: 0, extractionFailed: 0, highRisk: 0, uncategorised: 0, noAmount: 0 },
            ...over.receipts,
        },
        trips: { count: 14, km: 812.4 },
        bank: {
            hasStatement: true, feedActive: false, monthsInWindow: 3, monthsCovered: 3, monthsMissing: [],
            rowsTotal: 120, unreconciledRows: 0, unmatchedCredits: 0, unmatchedCreditsAmount: 0,
            ...over.bank,
        },
        assets: { count: 2, withoutFirstUse: 0, ...over.assets },
    };
}

describe('fewRowsThreshold', () => {
    it('is the larger of the absolute floor and the percentage', () => {
        expect(fewRowsThreshold(0)).toBe(3);
        expect(fewRowsThreshold(40)).toBe(3);    // 5% of 40 = 2 → floor wins
        expect(fewRowsThreshold(120)).toBe(6);   // 5% of 120 = 6
        expect(fewRowsThreshold(121)).toBe(7);   // ceil
        expect(fewRowsThreshold(120, { fewRowsAbsolute: 10 })).toBe(10);
        expect(fewRowsThreshold(120, { fewRowsPercent: 10 })).toBe(12);
    });
});

describe('composeConfidence', () => {
    it('no statement and no feed → 50 with only NO_STATEMENT', () => {
        const c = composeConfidence(inputs({
            bank: { hasStatement: false, monthsCovered: 0, monthsMissing: ['2026-07', '2026-08', '2026-09'], rowsTotal: 0 },
            receipts: { unreviewed: 5, notOpened: 5, categoryUnconfirmed: 5 }, // moot until there is a bank record
        }));
        expect(c.score).toBe(50);
        expect(c.reasons).toHaveLength(1);
        expect(c.reasons[0]).toMatchObject({ code: 'NO_STATEMENT', count: 3 });
    });

    it('a live feed counts as a bank record even with no statement', () => {
        const c = composeConfidence(inputs({ bank: { hasStatement: true, feedActive: true } }));
        expect(c.score).toBe(100);
    });

    it('statement present but paid invoices without a bank credit → 50, INVOICES_UNATTRIBUTED first, others informational', () => {
        const c = composeConfidence(inputs({
            invoices: { paidWithoutBankCredit: 2, paidWithoutBankCreditIds: ['i_1', 'i_2'] },
            receipts: { unreviewed: 3, notOpened: 1, categoryUnconfirmed: 2, inException: 1 },
            bank: { unreconciledRows: 2 },
        }));
        expect(c.score).toBe(50);
        expect(c.reasons.map((r) => r.code)).toEqual(['INVOICES_UNATTRIBUTED', 'BANK_ROWS_UNRECONCILED', 'RECEIPTS_UNREVIEWED']);
        expect(c.reasons[0].count).toBe(2);
        expect(c.reasons[0].detail).toContain('2 of 9');
    });

    it('unreconciled rows beyond a few + unreviewed receipts → 75 with both counts', () => {
        const c = composeConfidence(inputs({
            bank: { unreconciledRows: 14 },
            receipts: { unreviewed: 6, notOpened: 4, categoryUnconfirmed: 6, inException: 2 },
        }));
        expect(c.score).toBe(75);
        expect(c.reasons).toEqual([
            { code: 'BANK_ROWS_UNRECONCILED', count: 14, detail: '14 of 120 bank rows' },
            { code: 'RECEIPTS_UNREVIEWED', count: 6, detail: '4 not opened, 6 category unconfirmed, 2 need attention' },
        ]);
    });

    it('each 75-tier condition trips the rung on its own', () => {
        expect(composeConfidence(inputs({ receipts: { unreviewed: 1 } })).score).toBe(75);
        expect(composeConfidence(inputs({ bank: { unmatchedCredits: 1, unmatchedCreditsAmount: 1250 } })).score).toBe(75);
        expect(composeConfidence(inputs({ bank: { monthsCovered: 2, monthsMissing: ['2026-09'] } })).score).toBe(75);
        expect(composeConfidence(inputs({ bank: { unreconciledRows: 7 } })).score).toBe(75); // few = 6 for 120 rows
    });

    it('a missing month names the month; unmatched credits name the money', () => {
        const c = composeConfidence(inputs({
            bank: { monthsCovered: 2, monthsMissing: ['2026-09'], unmatchedCredits: 2, unmatchedCreditsAmount: 1850.5 },
        }));
        expect(c.score).toBe(75);
        expect(c.reasons).toEqual([
            { code: 'MONTH_MISSING', count: 1, detail: '2026-09' },
            { code: 'CREDITS_UNMATCHED', count: 2, detail: '$1850.50 across 2 credits no invoice explains' },
        ]);
    });

    it('all reviewed & attributed with 2 rows left → 90 with the row reason', () => {
        const c = composeConfidence(inputs({ bank: { unreconciledRows: 2 } }));
        expect(c.score).toBe(90);
        expect(c.reasons).toEqual([{ code: 'BANK_ROWS_UNRECONCILED', count: 2, detail: '2 of 120 bank rows' }]);
    });

    it('exactly "a few" unreconciled rows stays at 90; one more drops to 75', () => {
        expect(composeConfidence(inputs({ bank: { unreconciledRows: 6 } })).score).toBe(90);
        expect(composeConfidence(inputs({ bank: { unreconciledRows: 7 } })).score).toBe(75);
        // …and the threshold is tunable.
        expect(composeConfidence(inputs({ bank: { unreconciledRows: 7 } }), { fewRowsAbsolute: 10 }).score).toBe(90);
    });

    it('an asset without a first-used date caps the score at 90', () => {
        const c = composeConfidence(inputs({ assets: { count: 3, withoutFirstUse: 1 } }));
        expect(c.score).toBe(90);
        expect(c.reasons).toEqual([{ code: 'ASSETS_NO_FIRST_USE', count: 1, detail: '1 of 3 assets have no first-used date' }]);
    });

    it('everything reviewed, matched and covered → 100 with no reasons', () => {
        const c = composeConfidence(inputs());
        expect(c).toEqual({ score: 100, reasons: [] });
    });

    it('reasons always come back in ladder order whatever tripped the rung', () => {
        const c = composeConfidence(inputs({
            assets: { withoutFirstUse: 1 },
            receipts: { unreviewed: 2 },
            bank: { unmatchedCredits: 1, unmatchedCreditsAmount: 90, unreconciledRows: 9, monthsCovered: 2, monthsMissing: ['2026-07'] },
            invoices: { paidWithoutBankCredit: 1, paidWithoutBankCreditIds: ['i'] },
        }));
        expect(c.reasons.map((r) => r.code)).toEqual([
            'INVOICES_UNATTRIBUTED', 'MONTH_MISSING', 'BANK_ROWS_UNRECONCILED',
            'CREDITS_UNMATCHED', 'RECEIPTS_UNREVIEWED', 'ASSETS_NO_FIRST_USE',
        ]);
    });
});
