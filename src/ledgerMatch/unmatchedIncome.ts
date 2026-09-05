import { sql, type SQL } from 'drizzle-orm';

/**
 * THE definition of "unmatched income" for the whole platform — a bank credit
 * no invoice explains. Shared by `LedgerMatchPgRepo.listUnmatchedIncome`
 * (the review list) and `BasReportingPgRepo.inputs` (the confidence score),
 * so the two can never disagree about which credits are outstanding.
 *
 * Noise a real bank account carries that is NEVER invoice income is filtered
 * here:
 *   - credits under `minCents` (default $50 — bank interest cents),
 *   - payroll/salary/wages deposits, interest, and reversed direct debits
 *     ("Return … Direct Debit"), by descriptor,
 *   - rows a human already explained (category_source USER/ADVISOR — e.g.
 *     deliberately categorised as other income, or confirmed as they stand),
 *   - rows attributed to a known client (category_source PAYER — the payer
 *     is linked to a client, at ingest or by a later link, so the credit has
 *     a client even before an invoice is matched),
 *   - duplicates, transfer legs, and rows already matched to an invoice.
 *
 * Callers add their own scope (user_id / organization_id) and date bounds.
 * `alias` is the table alias in the caller's FROM clause.
 */
export const UNMATCHED_INCOME_MIN_CENTS = 5000;

const NOISE_DESCRIPTOR = sql.raw(`'\\m(interest|payroll|salary|wages|reversal)\\M'`);
const REVERSED_DEBIT = sql.raw(`'return.*direct debit'`);

/** Predicate over a `statement_transactions` row aliased `alias`. */
export function unmatchedIncomeStatementPredicate(alias = 'st', minCents = UNMATCHED_INCOME_MIN_CENTS): SQL {
    const a = sql.raw(alias);
    return sql`(
        ${a}.amount_cents >= ${minCents}
        AND (${a}.direction IS NULL OR ${a}.direction = 'CREDIT')
        AND (${a}.flow_class IS NULL OR ${a}.flow_class = 'INCOME')
        AND ${a}.duplicate_of_txn_id IS NULL
        AND ${a}.transfer_pair_id IS NULL
        AND ${a}.matched_invoice_id IS NULL
        AND ${a}.txn_date IS NOT NULL
        AND (${a}.category_source IS NULL OR ${a}.category_source NOT IN ('USER', 'ADVISOR', 'PAYER'))
        AND (${a}.description IS NULL OR (
              ${a}.description !~* ${NOISE_DESCRIPTOR}
          AND ${a}.description !~* ${REVERSED_DEBIT}))
    )`;
}

/** Predicate over a `bank_transactions` (live feed) row aliased `alias`. Feed rows carry no flow_class / transfer pairing. */
export function unmatchedIncomeFeedPredicate(alias = 'bt', minCents = UNMATCHED_INCOME_MIN_CENTS): SQL {
    const a = sql.raw(alias);
    return sql`(
        ${a}.amount_cents >= ${minCents}
        AND (${a}.direction IS NULL OR ${a}.direction = 'CREDIT')
        AND ${a}.duplicate_of_txn_id IS NULL
        AND ${a}.matched_invoice_id IS NULL
        AND ${a}.txn_date IS NOT NULL
        AND (${a}.category_source IS NULL OR ${a}.category_source NOT IN ('USER', 'ADVISOR', 'PAYER'))
        AND (${a}.description IS NULL OR (
              ${a}.description !~* ${NOISE_DESCRIPTOR}
          AND ${a}.description !~* ${REVERSED_DEBIT}))
    )`;
}
