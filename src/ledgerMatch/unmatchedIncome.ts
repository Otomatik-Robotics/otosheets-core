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
 *   - own-money movement: a statement row by the flow class the ingest
 *     derived, a feed row by its descriptor (see TRANSFER_DESCRIPTOR),
 *   - duplicates, transfer legs, and rows already matched to an invoice.
 *
 * Callers add their own scope (user_id / organization_id) and date bounds.
 * `alias` is the table alias in the caller's FROM clause.
 */
export const UNMATCHED_INCOME_MIN_CENTS = 5000;

const NOISE_DESCRIPTOR = sql.raw(`'\\m(interest|payroll|salary|wages|reversal)\\M'`);
const REVERSED_DEBIT = sql.raw(`'return.*direct debit'`);

/**
 * Own money moving between the user's own accounts, read off the descriptor.
 *
 * A statement row carries the flow class the ingest derived, and the statement
 * predicate gates on it (`flow_class = 'INCOME'`). A feed row has no such
 * column, so the same judgement has to be made here, and the patterns mirror
 * TRANSFER_PATTERNS in the backend's txnClass.ts one for one.
 *
 * Without this clause the feed's watchlist and the payer link disagree about
 * one row: "INTERNET TRANSFER FROM SMITH BUILDING" would sit on the list
 * offering "Link payer to a client", and the link's feed sweep would then
 * refuse to re-attribute it (correctly — booking a transfer as GST-inclusive
 * income puts the user's own money in the BAS), leaving the credit on the list
 * with the action reporting success. Either the row is a client payment on
 * both surfaces or it is a transfer on both.
 */
const TRANSFER_DESCRIPTOR = sql.raw(`'\\y(tfr|xfer|drawdown|ato)\\y`
    + `|\\ytransfer\\s+(to|from|between)\\y`
    + `|\\y(internet|netbank|online|mobile|internal|interbank)\\s+transfer\\y`
    + `|\\yown\\s+account\\y`
    + `|\\ycredit\\s+card\\s+(payment|pymt|repayment)\\y`
    + `|\\ypayment\\s+to\\s+credit\\s+card\\y`
    + `|\\yloan\\s+(drawdown|repayment|payment)\\y`
    + `|\\ytaxation\\s+office\\y'`);

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

/**
 * Predicate over a `bank_transactions` (live feed) row aliased `alias`. Feed
 * rows carry no flow_class / transfer pairing, so the own-money gate the
 * statement predicate gets from `flow_class` is applied here from the
 * descriptor instead.
 */
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
          AND ${a}.description !~* ${REVERSED_DEBIT}
          AND ${a}.description !~* ${TRANSFER_DESCRIPTOR}))
    )`;
}
