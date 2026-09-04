import type { BasInputs, BasConfidence, BasConfidenceScore, BasReason } from './schema';

/**
 * The BAS confidence ladder — pure, store-free. `inputs.pg.ts` gathers the
 * facts; this decides what they mean, so the rules live and are tested in
 * exactly one place (invoice/summary.ts precedent).
 *
 *   50   no bank statement and no live feed — nothing to reconcile against
 *   50   a statement exists but paid invoices have no bank credit behind them
 *   75   unreviewed receipts, unmatched credits, an uncovered month, or more
 *        than a few unreconciled bank rows
 *   90   a few unreconciled rows, or an asset with no first-used date
 *  100   everything reviewed, matched and covered
 *
 * "A few" = max(fewRowsAbsolute, ceil(rowsTotal × fewRowsPercent / 100)).
 *
 * Reasons come back in ladder order (the canonical BasReasonCode order), so
 * the first entry is what the score is stuck on. At 50 with no statement the
 * list is just NO_STATEMENT — everything else is moot until there is a bank
 * record. At every other rung every applicable reason is listed, including
 * informational ones the current rung does not hinge on.
 */
export interface ComposeConfidenceOptions {
    /** Floor for "a few" unreconciled rows. Default 3. */
    fewRowsAbsolute?: number;
    /** Percentage of rowsTotal that still counts as "a few". Default 5. */
    fewRowsPercent?: number;
}

const money = (n: number): string => `$${n.toFixed(2)}`;

/** How many unreconciled rows are still "a few" for this window. */
export function fewRowsThreshold(rowsTotal: number, opts?: ComposeConfidenceOptions): number {
    const abs = opts?.fewRowsAbsolute ?? 3;
    const pct = opts?.fewRowsPercent ?? 5;
    return Math.max(abs, Math.ceil((rowsTotal * pct) / 100));
}

export function composeConfidence(inputs: BasInputs, opts?: ComposeConfidenceOptions): BasConfidence {
    const { bank, receipts, invoices, assets } = inputs;
    const few = fewRowsThreshold(bank.rowsTotal, opts);
    const noStatement = !bank.hasStatement && !bank.feedActive;

    if (noStatement) {
        return {
            score: 50,
            reasons: [{
                code: 'NO_STATEMENT',
                count: bank.monthsInWindow,
                detail: 'No bank statement or live feed covers this period',
            }],
        };
    }

    // Every applicable reason, in canonical order.
    const reasons: BasReason[] = [];
    if (invoices.paidWithoutBankCredit > 0) {
        reasons.push({
            code: 'INVOICES_UNATTRIBUTED',
            count: invoices.paidWithoutBankCredit,
            detail: `${invoices.paidWithoutBankCredit} of ${invoices.paidCount} paid invoices have no bank credit behind them`,
        });
    }
    if (bank.monthsMissing.length > 0) {
        reasons.push({
            code: 'MONTH_MISSING',
            count: bank.monthsMissing.length,
            detail: bank.monthsMissing.join(', '),
        });
    }
    if (bank.unreconciledRows > 0) {
        reasons.push({
            code: 'BANK_ROWS_UNRECONCILED',
            count: bank.unreconciledRows,
            detail: `${bank.unreconciledRows} of ${bank.rowsTotal} bank rows`,
        });
    }
    if (bank.unmatchedCredits > 0) {
        reasons.push({
            code: 'CREDITS_UNMATCHED',
            count: bank.unmatchedCredits,
            detail: `${money(bank.unmatchedCreditsAmount)} across ${bank.unmatchedCredits} credits no invoice explains`,
        });
    }
    if (receipts.unreviewed > 0) {
        reasons.push({
            code: 'RECEIPTS_UNREVIEWED',
            count: receipts.unreviewed,
            detail: `${receipts.notOpened} not opened, ${receipts.categoryUnconfirmed} category unconfirmed, ${receipts.inException} need attention`,
        });
    }
    if (assets.withoutFirstUse > 0) {
        reasons.push({
            code: 'ASSETS_NO_FIRST_USE',
            count: assets.withoutFirstUse,
            detail: `${assets.withoutFirstUse} of ${assets.count} assets have no first-used date`,
        });
    }

    let score: BasConfidenceScore;
    if (invoices.paidWithoutBankCredit > 0) {
        score = 50;
    } else if (
        receipts.unreviewed > 0
        || bank.unmatchedCredits > 0
        || bank.monthsMissing.length > 0
        || bank.unreconciledRows > few
    ) {
        score = 75;
    } else if (bank.unreconciledRows > 0 || assets.withoutFirstUse > 0) {
        score = 90;
    } else {
        score = 100;
    }
    return { score, reasons };
}
