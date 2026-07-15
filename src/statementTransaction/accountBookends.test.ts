import { describe, it, expect } from 'vitest';
import { foldAccountGroups, type RawAccountGroup } from './accountBookends';

/** A fully-null baseline group; spread overrides for the fields a test cares about. */
function group(over: Partial<RawAccountGroup>): RawAccountGroup {
    return {
        accountId: 'acc1',
        bankName: 'CBA',
        accountLast4: '1234',
        inCents: 0,
        outCents: 0,
        txnNetCents: 0,
        stmtOpeningCents: null,
        stmtClosingCents: null,
        minPeriodStart: null,
        maxPeriodEnd: null,
        chainOpeningCents: null,
        chainClosingCents: null,
        minTxnDate: null,
        maxTxnDate: null,
        txnCount: 0,
        statementCount: 0,
        ...over,
    };
}

describe('foldAccountGroups — bookend selection', () => {
    it('prefers the FY-accurate chain bookends and reconciles opening + in − out = closing', () => {
        // A statement straddling the FY boundary: its whole-statement (stmt)
        // bookends span more than the FY-sliced in/out, so they DON'T reconcile.
        // The chain bookends are scoped to exactly the in-scope rows and DO.
        const [row] = foldAccountGroups([group({
            inCents: 100_000,
            outCents: 30_000,
            txnNetCents: 70_000,
            // stmt bookends would give 450000 + 100000 − 30000 = 520000 ≠ 570000
            stmtOpeningCents: 450_000,
            stmtClosingCents: 570_000,
            // chain bookends: balance before first FY txn / after last FY txn
            chainOpeningCents: 500_000,
            chainClosingCents: 570_000,
            minTxnDate: '2025-07-01',
            maxTxnDate: '2026-06-30',
            txnCount: 12,
            statementCount: 3,
        })]);

        expect(row.openingBalanceCents).toBe(500_000);   // chain, not stmt (450000)
        expect(row.closingBalanceCents).toBe(570_000);
        expect(row.netCents).toBe(70_000);
        // The property that was broken: the card now reconciles.
        expect(row.openingBalanceCents! + row.inCents - row.outCents).toBe(row.closingBalanceCents);
    });

    it('falls back to statement bookends when no running balance is present (CSV / feed)', () => {
        const [row] = foldAccountGroups([group({
            inCents: 100_000,
            outCents: 30_000,
            txnNetCents: 70_000,
            stmtOpeningCents: 450_000,
            stmtClosingCents: 520_000,
            chainOpeningCents: null,
            chainClosingCents: null,
        })]);

        expect(row.openingBalanceCents).toBe(450_000);
        expect(row.closingBalanceCents).toBe(520_000);
        expect(row.netCents).toBe(70_000); // 520000 − 450000
    });

    it('falls back to the signed transaction sum when no bookends exist at all', () => {
        const [row] = foldAccountGroups([group({
            inCents: 100_000,
            outCents: 30_000,
            txnNetCents: 70_000,
        })]);

        expect(row.openingBalanceCents).toBeNull();
        expect(row.closingBalanceCents).toBeNull();
        expect(row.netCents).toBe(70_000);
    });

    it('surfaces a real gap (unmarked duplicate) instead of hiding it — chain bookends stay independent', () => {
        // in/out double-counted (+70000 flow) but the real balance chain moved
        // only +40000. Chain bookends are independent reals, so opening + in − out
        // ≠ closing — which is exactly what the frontend honesty guard flags.
        const [row] = foldAccountGroups([group({
            inCents: 100_000,
            outCents: 30_000,
            txnNetCents: 70_000,
            chainOpeningCents: 500_000,
            chainClosingCents: 540_000, // real movement only +40000
            minTxnDate: '2025-07-01',
            maxTxnDate: '2026-06-30',
        })]);

        expect(row.netCents).toBe(40_000); // balance truth, not the inflated flow
        expect(row.openingBalanceCents! + row.inCents - row.outCents).not.toBe(row.closingBalanceCents);
    });
});

describe('foldAccountGroups — legacy (null-accountId) merge', () => {
    it('folds a null-accountId group into its identified home and keeps the outer chain bookends', () => {
        const legacyJul = group({
            accountId: null,
            inCents: 40_000, outCents: 0, txnNetCents: 40_000,
            chainOpeningCents: 500_000, chainClosingCents: 540_000,
            minTxnDate: '2025-07-01', maxTxnDate: '2025-07-31',
            txnCount: 3, statementCount: 1,
        });
        const identifiedAug = group({
            accountId: 'acc1',
            inCents: 30_000, outCents: 0, txnNetCents: 30_000,
            chainOpeningCents: 540_000, chainClosingCents: 570_000,
            minTxnDate: '2025-08-01', maxTxnDate: '2025-08-31',
            txnCount: 2, statementCount: 1,
        });

        const rows = foldAccountGroups([identifiedAug, legacyJul]);
        expect(rows).toHaveLength(1);
        const [row] = rows;

        expect(row.accountId).toBe('acc1');
        expect(row.inCents).toBe(70_000);
        expect(row.txnCount).toBe(5);
        expect(row.statementCount).toBe(2);
        // earliest opening (Jul) → latest closing (Aug); interior bookends dropped.
        expect(row.openingBalanceCents).toBe(500_000);
        expect(row.closingBalanceCents).toBe(570_000);
        expect(row.netCents).toBe(70_000);
        expect(row.openingBalanceCents! + row.inCents - row.outCents).toBe(row.closingBalanceCents);
    });

    it('keeps a legacy group standing alone when no identified home shares its (bank, last4)', () => {
        const rows = foldAccountGroups([
            group({ accountId: 'acc1', bankName: 'CBA', accountLast4: '1111', txnNetCents: 10_000 }),
            group({ accountId: null, bankName: 'ANZ', accountLast4: '9999', txnNetCents: 5_000 }),
        ]);
        expect(rows).toHaveLength(2);
        expect(rows.map(r => r.accountLast4).sort()).toEqual(['1111', '9999']);
    });

    it('sorts by net descending', () => {
        const rows = foldAccountGroups([
            group({ accountId: 'a', accountLast4: '1', txnNetCents: 10_000 }),
            group({ accountId: 'b', accountLast4: '2', txnNetCents: 90_000 }),
            group({ accountId: 'c', accountLast4: '3', txnNetCents: 50_000 }),
        ]);
        expect(rows.map(r => r.netCents)).toEqual([90_000, 50_000, 10_000]);
    });

    it('does not mutate the caller\'s input rows', () => {
        const identified = group({ accountId: 'acc1', inCents: 30_000 });
        const legacy = group({ accountId: null, inCents: 40_000 });
        foldAccountGroups([identified, legacy]);
        expect(identified.inCents).toBe(30_000); // untouched despite the in-place merge
    });
});
