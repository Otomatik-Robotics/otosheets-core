/**
 * Account rollup folding — pure, DB-free (mirrors the backend's dedupe/continuity
 * engines) so it can be unit-tested without Postgres.
 *
 * `summariseByAccount` runs one grouped query and hands the raw per-group rows
 * here. Two jobs:
 *
 *  1. Merge null-accountId ("legacy", pre-backfill) groups into the identified
 *     group that shares their (bankName, last4), so one real account never
 *     renders as two cards mid-backfill.
 *
 *  2. Choose each account's opening/closing bookends. There are two sources:
 *       - statement bookends: the earliest statement's opening + latest
 *         statement's closing (whole-statement `verification` balances).
 *       - chain bookends: the running balance carried on each transaction —
 *         the balance *before* the first in-scope transaction (opening) and
 *         *after* the last (closing).
 *     We PREFER the chain bookends when both are present, because they are
 *     scoped to exactly the transactions being summed (FY-filtered, deduped).
 *     Statement bookends span the whole statement, so when a statement straddles
 *     the financial-year boundary they anchor to a different date range than the
 *     `in`/`out` totals and the two can't reconcile. The chain bookends are
 *     FY-accurate and reconcile by construction whenever the balance chain is
 *     intact; statement bookends remain the fallback for feeds/CSV that carry no
 *     per-row running balance.
 */

export interface AccountRollup {
    accountId: string | null;
    bankName: string | null;
    accountLast4: string | null;
    inCents: number;
    outCents: number;
    netCents: number;
    openingBalanceCents: number | null;
    closingBalanceCents: number | null;
    txnCount: number;
    statementCount: number;
}

/** One grouped row straight out of the account-summary query, before folding. */
export interface RawAccountGroup {
    accountId: string | null;
    bankName: string | null;
    accountLast4: string | null;
    inCents: number;
    outCents: number;
    /** Signed Σ of every in-scope amount — the flow net (fallback for netCents). */
    txnNetCents: number;
    /** Earliest statement's opening balance (whole-statement `verification`). */
    stmtOpeningCents: number | null;
    /** Latest statement's closing balance (whole-statement `verification`). */
    stmtClosingCents: number | null;
    minPeriodStart: string | null;
    maxPeriodEnd: string | null;
    /** Running balance before the first in-scope transaction (FY-accurate). */
    chainOpeningCents: number | null;
    /** Running balance after the last in-scope transaction (FY-accurate). */
    chainClosingCents: number | null;
    minTxnDate: string | null;
    maxTxnDate: string | null;
    txnCount: number;
    statementCount: number;
}

// Null period/date sorts LAST: treat as the far end so a real bookend always wins.
const asEarliest = (d: string | null) => d ?? '9999-12-31';
const asLatest = (d: string | null) => d ?? '0000-01-01';

/** Fold a legacy (null-accountId) group into its identified home, in place. */
function absorb(home: RawAccountGroup, legacy: RawAccountGroup): void {
    home.inCents += legacy.inCents;
    home.outCents += legacy.outCents;
    home.txnNetCents += legacy.txnNetCents;
    home.txnCount += legacy.txnCount;
    home.statementCount += legacy.statementCount;

    // Statement bookends follow the statement periods: earliest opening, latest closing.
    if (legacy.stmtOpeningCents != null
        && (home.stmtOpeningCents == null || asEarliest(legacy.minPeriodStart) < asEarliest(home.minPeriodStart))) {
        home.stmtOpeningCents = legacy.stmtOpeningCents;
    }
    if (legacy.stmtClosingCents != null
        && (home.stmtClosingCents == null || asLatest(legacy.maxPeriodEnd) > asLatest(home.maxPeriodEnd))) {
        home.stmtClosingCents = legacy.stmtClosingCents;
    }
    if (asEarliest(legacy.minPeriodStart) < asEarliest(home.minPeriodStart)) home.minPeriodStart = legacy.minPeriodStart;
    if (asLatest(legacy.maxPeriodEnd) > asLatest(home.maxPeriodEnd)) home.maxPeriodEnd = legacy.maxPeriodEnd;

    // Chain bookends follow the transaction dates. A null balance at the new
    // frontier makes the chain unusable there (and the resolver then falls back).
    if (legacy.minTxnDate != null && (home.minTxnDate == null || legacy.minTxnDate < home.minTxnDate)) {
        home.chainOpeningCents = legacy.chainOpeningCents;
        home.minTxnDate = legacy.minTxnDate;
    }
    if (legacy.maxTxnDate != null && (home.maxTxnDate == null || legacy.maxTxnDate > home.maxTxnDate)) {
        home.chainClosingCents = legacy.chainClosingCents;
        home.maxTxnDate = legacy.maxTxnDate;
    }
}

/** Resolve one folded group's bookends + net, preferring the FY-accurate chain. */
function resolve(g: RawAccountGroup): AccountRollup {
    const useChain = g.chainOpeningCents != null && g.chainClosingCents != null;
    const openingBalanceCents = useChain ? g.chainOpeningCents : g.stmtOpeningCents;
    const closingBalanceCents = useChain ? g.chainClosingCents : g.stmtClosingCents;
    // Balance-anchored net when we have both bookends; the transaction sum is
    // only the fallback (a statement with no verified balance and no chain).
    const netCents = openingBalanceCents != null && closingBalanceCents != null
        ? closingBalanceCents - openingBalanceCents
        : g.txnNetCents;
    return {
        accountId: g.accountId,
        bankName: g.bankName,
        accountLast4: g.accountLast4,
        inCents: g.inCents,
        outCents: g.outCents,
        netCents,
        openingBalanceCents,
        closingBalanceCents,
        txnCount: g.txnCount,
        statementCount: g.statementCount,
    };
}

/**
 * Merge legacy groups into their identified homes, resolve bookends, and sort by
 * net descending. Pure — the caller supplies the raw grouped query rows.
 */
export function foldAccountGroups(groups: RawAccountGroup[]): AccountRollup[] {
    // Clone so the in-place merge never mutates the caller's rows.
    const identified = groups.filter((g) => g.accountId != null).map((g) => ({ ...g }));
    const merged: RawAccountGroup[] = [...identified];
    for (const legacy of groups.filter((g) => g.accountId == null)) {
        const home = identified.find((g) => g.bankName === legacy.bankName && g.accountLast4 === legacy.accountLast4);
        if (!home) { merged.push({ ...legacy }); continue; }
        absorb(home, legacy);
    }
    return merged.map(resolve).sort((a, b) => b.netCents - a.netCents);
}
