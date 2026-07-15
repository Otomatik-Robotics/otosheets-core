/**
 * Statement-reconciliation backfill (one-off, idempotent, re-runnable):
 *
 *   1. Stamp `statements.account_id` for historical statements using their
 *      persisted bankName/accountLast4 (no reprocessing, no Textract) —
 *      reusing findOrCreateStatementAccount so feed accounts unify.
 *   2. Retro-dedupe statement rows per account: walk statements in period
 *      order; a later statement's row exactly matching an earlier statement's
 *      row (date + amount + normalised description) is marked duplicate.
 *   3. Retro-dedupe feed rows against statement rows of the same account
 *      (statement rows win — they are chain-verified).
 *
 * Usage:
 *   export DATABASE_URL=...
 *   node dist/scripts/backfillStatementAccounts.js --report   # dry run
 *   node dist/scripts/backfillStatementAccounts.js            # write
 */
import { sql } from 'drizzle-orm';
import { getPg } from '../pg/client';
import { BankAccountPgRepo } from '../bankAccount/repo.pg';

function normaliseDescription(description: string | null): string {
    return (description ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function rowKey(r: { txnDate: string | null; amountCents: number; description: string | null }): string | null {
    if (!r.txnDate) return null;
    return `${r.txnDate}|${r.amountCents}|${normaliseDescription(r.description)}`;
}

interface SlimRow { txnId: string; statementId: string; txnDate: string | null; amountCents: number; description: string | null }

async function markDuplicates(table: string, updates: Array<{ txnId: string; duplicateOfTxnId: string }>, write: boolean): Promise<void> {
    if (!write || updates.length === 0) return;
    const db = getPg();
    const CHUNK = 200;
    for (let i = 0; i < updates.length; i += CHUNK) {
        const values = sql.join(
            updates.slice(i, i + CHUNK).map((u) => sql`(${u.txnId}, ${u.duplicateOfTxnId})`),
            sql`, `,
        );
        await db.execute(sql`
            UPDATE ${sql.raw(table)} AS t
            SET duplicate_of_txn_id = v.dup_id, updated_at = now()
            FROM (VALUES ${values}) AS v(txn_id, dup_id)
            WHERE t.txn_id = v.txn_id AND t.duplicate_of_txn_id IS NULL
        `);
    }
}

export async function backfillStatementAccounts(write: boolean): Promise<void> {
    const db = getPg();
    const accountRepo = new BankAccountPgRepo();
    console.log(`statement-accounts backfill (${write ? 'WRITE' : 'REPORT-ONLY'})`);

    // ── Phase 1: stamp account_id from the persisted bank + last-4 ──
    const unstamped: any = await db.execute(sql`
        SELECT statement_id, user_id, organization_id, business_profile_id, bank_name, account_last4
        FROM statements
        WHERE account_id IS NULL
          AND user_id NOT LIKE 'prospect#%'
          AND account_last4 IS NOT NULL
    `);
    const rows = unstamped.rows ?? unstamped;
    let stamped = 0;
    for (const s of rows) {
        const account = write
            ? await accountRepo.findOrCreateStatementAccount({
                userId: s.user_id,
                bankName: s.bank_name ?? null,
                accountLast4: s.account_last4,
                organizationId: s.organization_id ?? null,
                businessProfileId: s.business_profile_id ?? null,
            })
            : { accountId: '(dry-run)' };
        if (!account) continue;
        if (write) {
            await db.execute(sql`
                UPDATE statements SET account_id = ${account.accountId}, updated_at = now()
                WHERE statement_id = ${s.statement_id} AND account_id IS NULL
            `);
        }
        stamped += 1;
    }
    console.log(`[accounts] candidates=${rows.length} stamped=${stamped}`);

    // ── Phase 2 + 3: retro-dedupe per account ──
    const accountsRes: any = await db.execute(sql`
        SELECT DISTINCT account_id, user_id FROM statements WHERE account_id IS NOT NULL
    `);
    let stmtDups = 0;
    let feedDups = 0;
    for (const a of (accountsRes.rows ?? accountsRes)) {
        const stmtRes: any = await db.execute(sql`
            SELECT t.txn_id, t.statement_id, t.txn_date::text AS txn_date, t.amount_cents, t.description
            FROM statement_transactions t
            JOIN statements s ON s.statement_id = t.statement_id
            WHERE s.account_id = ${a.account_id} AND t.duplicate_of_txn_id IS NULL
            ORDER BY s.period_start ASC NULLS LAST, s.created_at ASC, t.seq ASC
        `);
        const stmtRows: SlimRow[] = (stmtRes.rows ?? stmtRes).map((r: any) => ({
            txnId: r.txn_id, statementId: r.statement_id, txnDate: r.txn_date,
            amountCents: Number(r.amount_cents), description: r.description,
        }));

        // Statement-vs-statement: earlier statement's row is the original; each
        // original absorbs at most one duplicate (multiset semantics).
        const seen = new Map<string, Array<{ txnId: string; statementId: string }>>();
        const stmtUpdates: Array<{ txnId: string; duplicateOfTxnId: string }> = [];
        for (const row of stmtRows) {
            const key = rowKey(row);
            if (!key) continue;
            const queue = seen.get(key) ?? [];
            const idx = queue.findIndex((o) => o.statementId !== row.statementId);
            if (idx >= 0) {
                const original = queue.splice(idx, 1)[0];
                stmtUpdates.push({ txnId: row.txnId, duplicateOfTxnId: original.txnId });
            } else {
                queue.push({ txnId: row.txnId, statementId: row.statementId });
                seen.set(key, queue);
            }
        }
        await markDuplicates('statement_transactions', stmtUpdates, write);
        stmtDups += stmtUpdates.length;

        // Feed-vs-statement: chain-verified statement rows win; the feed copy
        // is marked. Surviving (non-duplicate) statement rows are the originals.
        const feedRes: any = await db.execute(sql`
            SELECT txn_id, txn_date::text AS txn_date, amount_cents, description
            FROM bank_transactions
            WHERE account_id = ${a.account_id} AND duplicate_of_txn_id IS NULL
            ORDER BY txn_date ASC NULLS LAST, txn_id ASC
        `);
        const marked = new Set(stmtUpdates.map((u) => u.txnId));
        const originals = new Map<string, string[]>();
        for (const row of stmtRows) {
            if (marked.has(row.txnId)) continue;
            const key = rowKey(row);
            if (!key) continue;
            const queue = originals.get(key);
            if (queue) queue.push(row.txnId);
            else originals.set(key, [row.txnId]);
        }
        const feedUpdates: Array<{ txnId: string; duplicateOfTxnId: string }> = [];
        for (const r of (feedRes.rows ?? feedRes)) {
            const key = rowKey({ txnDate: r.txn_date, amountCents: Number(r.amount_cents), description: r.description });
            if (!key) continue;
            const original = originals.get(key)?.shift();
            if (original) feedUpdates.push({ txnId: r.txn_id, duplicateOfTxnId: original });
        }
        await markDuplicates('bank_transactions', feedUpdates, write);
        feedDups += feedUpdates.length;
    }
    console.log(`[dedupe] statement-vs-statement=${stmtDups} feed-vs-statement=${feedDups}`);
    console.log(write ? 'Backfill complete.' : 'Dry run complete — re-run without --report to write.');
}

if (require.main === module) {
    const reportOnly = process.argv.includes('--report');
    backfillStatementAccounts(!reportOnly).catch((err) => {
        console.error('Backfill failed:', err);
        process.exit(1);
    });
}
