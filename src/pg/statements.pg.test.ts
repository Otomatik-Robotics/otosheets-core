import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from './migrate';
import type { PgDb } from './client';
import { StatementPgRepo } from '../statement/repo.pg';
import { StatementTransactionPgRepo, statementTxnId } from '../statementTransaction/repo.pg';

let db: PgDb;
let pglite: PGlite;

const USER = 'user_1';
const STMT = '01STATEMENT000000000000001';

function txn(seq: number, overrides: Record<string, any> = {}) {
    return {
        txnId: statementTxnId(STMT, seq),
        statementId: STMT,
        userId: USER,
        fy: '2025-26',
        seq,
        page: 1,
        rowIndex: seq,
        bbox: { x: 0.1, y: 0.1 * seq, w: 0.8, h: 0.02 },
        rawText: `raw row ${seq}`,
        txnDate: '2025-08-0' + ((seq % 9) + 1),
        description: `Vendor ${seq}`,
        amountCents: -1000 * seq,
        direction: 'DEBIT',
        balanceCents: 100000 - 1000 * seq,
        chainOk: true,
        ...overrides,
    };
}

beforeAll(async () => {
    pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = {
        exec: async (statement: string) => {
            const res = await pglite.query(statement);
            return { rows: res.rows as any[] };
        },
    };
    const ran = await runMigrations(executor);
    expect(ran).toContain('0003_statements.sql');
    expect(await runMigrations(executor)).toEqual([]); // idempotent
    db = drizzle(pglite) as unknown as PgDb;
});

describe('StatementPgRepo', () => {
    const repo = () => new StatementPgRepo(db);

    it('creates idempotently and reads back a DTO', async () => {
        const input = {
            statementId: STMT, userId: USER, fy: '2025-26',
            fileName: 'aug.pdf', fileType: 'application/pdf',
            s3Key: `statements/${USER}/2025-26/${STMT}.pdf`,
        };
        await repo().createStatement(input);
        await repo().createStatement(input); // retried presign — no throw, no dup
        const stmt = await repo().getStatement(USER, STMT);
        expect(stmt).toMatchObject({
            statementId: STMT, status: 'UPLOADED', extractionVersion: 0, fy: '2025-26',
        });
        expect(typeof stmt!.createdAt).toBe('string');
    });

    it('conditional status flip: first caller wins, duplicate loses', async () => {
        const first = await repo().updateStatementStatusConditional(
            STMT, ['UPLOADED'], { status: 'EXTRACTING' });
        const second = await repo().updateStatementStatusConditional(
            STMT, ['UPLOADED'], { status: 'EXTRACTING' });
        expect(first).toBe(true);
        expect(second).toBe(false);
        expect((await repo().getStatement(USER, STMT))!.status).toBe('EXTRACTING');
    });

    it('finds duplicates by content hash, excluding self', async () => {
        await repo().updateStatement(STMT, { contentHash: 'hash_a' });
        expect(await repo().findStatementByContentHash(USER, 'hash_a', STMT)).toBeNull();
        expect(await repo().findStatementByContentHash(USER, 'hash_a')).not.toBeNull();
        expect(await repo().findStatementByContentHash('other_user', 'hash_a')).toBeNull();
    });

    it('lists newest-first with keyset pagination', async () => {
        for (let i = 2; i <= 4; i++) {
            await repo().createStatement({
                statementId: `${STMT.slice(0, -1)}${i}`, userId: USER, fy: '2025-26',
                s3Key: `statements/${USER}/2025-26/s${i}.pdf`,
            });
            await new Promise((r) => setTimeout(r, 5));
        }
        const page1 = await repo().listStatements(USER, { fy: '2025-26', limit: 2 });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextToken).toBeTruthy();
        const page2 = await repo().listStatements(USER, { fy: '2025-26', limit: 10, nextToken: page1.nextToken });
        expect(page2.nextToken).toBeNull();
        const all = [...page1.items, ...page2.items].map((s) => s.statementId);
        expect(new Set(all).size).toBe(4);
    });

    it('adjusts needs-review count atomically, floored at zero', async () => {
        await repo().setProcessingResult(STMT, { status: 'NEEDS_REVIEW', needsReviewCount: 2 });
        expect(await repo().adjustNeedsReviewCount(STMT, -1)).toBe(1);
        expect(await repo().adjustNeedsReviewCount(STMT, -1)).toBe(0);
        expect(await repo().adjustNeedsReviewCount(STMT, -1)).toBe(0); // floor
        expect(await repo().adjustNeedsReviewCount('missing', -1)).toBeNull();
    });

    it('stores calendar dates as plain YYYY-MM-DD, never a shifted timestamp', async () => {
        await repo().setProcessingResult(STMT, {
            status: 'VERIFIED', periodStart: '2025-08-02', periodEnd: '2025-08-31',
        });
        const stmt = await repo().getStatement(USER, STMT);
        expect(stmt!.periodStart).toBe('2025-08-02'); // not '2025-08-01T16:00:00.000Z'
        expect(stmt!.periodEnd).toBe('2025-08-31');
    });

    it('persists a period conflict, then a user resolution clears it', async () => {
        // Conflict path: no period, source unset, candidate ranges stored for the modal.
        await repo().setProcessingResult(STMT, {
            status: 'NEEDS_REVIEW',
            periodStart: null,
            periodEnd: null,
            periodSource: null,
            periodConflict: {
                rowStart: '2025-07-28', rowEnd: '2025-09-02',
                statementStart: '2025-08-01', statementEnd: '2025-08-31',
            },
        });
        let stmt = await repo().getStatement(USER, STMT);
        expect(stmt!.periodStart).toBeNull();
        expect(stmt!.periodConflict).toEqual({
            rowStart: '2025-07-28', rowEnd: '2025-09-02',
            statementStart: '2025-08-01', statementEnd: '2025-08-31',
        });

        // User picks a period → source 'user', conflict cleared, status flipped.
        const ok = await repo().resolvePeriod(USER, STMT, {
            periodStart: '2025-08-01', periodEnd: '2025-08-31', status: 'VERIFIED',
        });
        expect(ok).toBe(true);
        stmt = await repo().getStatement(USER, STMT);
        expect(stmt).toMatchObject({
            periodStart: '2025-08-01', periodEnd: '2025-08-31',
            periodSource: 'user', periodConflict: null, status: 'VERIFIED',
        });

        // Tenancy: another user cannot resolve someone else's statement.
        expect(await repo().resolvePeriod('intruder', STMT, {
            periodStart: '2025-08-01', periodEnd: '2025-08-31',
        })).toBe(false);
    });
});

describe('StatementTransactionPgRepo', () => {
    const repo = () => new StatementTransactionPgRepo(db);

    it('upserts idempotently on deterministic ids', async () => {
        await repo().upsertTransactions([txn(1), txn(2), txn(3, { reviewReason: 'LOW_CONFIDENCE' })]);
        await repo().upsertTransactions([txn(1, { description: 'Vendor 1 v2' }), txn(2), txn(3, { reviewReason: 'LOW_CONFIDENCE' })]);
        const { items } = await repo().listByStatement(USER, STMT);
        expect(items).toHaveLength(3);
        expect(items[0].description).toBe('Vendor 1 v2'); // overwrite, not duplicate
        expect(items[0].bbox).toEqual({ x: 0.1, y: 0.1, w: 0.8, h: 0.02 });
        expect(items[0].txnDate).toMatch(/^\d{4}-\d{2}-\d{2}$/); // plain date, no time/tz
    });

    it('paginates by seq and filters reviewOnly', async () => {
        const page1 = await repo().listByStatement(USER, STMT, { limit: 2 });
        expect(page1.items.map((t) => t.seq)).toEqual([1, 2]);
        const page2 = await repo().listByStatement(USER, STMT, { limit: 2, nextToken: page1.nextToken });
        expect(page2.items.map((t) => t.seq)).toEqual([3]);
        expect(page2.nextToken).toBeNull();

        const review = await repo().listByStatement(USER, STMT, { reviewOnly: true });
        expect(review.items.map((t) => t.seq)).toEqual([3]);
    });

    it('lists FY-wide newest date first', async () => {
        const { items } = await repo().listByFy(USER, '2025-26', { limit: 10 });
        expect(items.length).toBeGreaterThanOrEqual(3);
        const dates = items.map((t) => t.txnDate ?? '0001-01-01');
        expect([...dates].sort().reverse()).toEqual(dates);
    });

    it('updateCategory reports prior review flag exactly once', async () => {
        const first = await repo().updateCategory(USER, STMT, 3, {
            category: 'Software', categorySource: 'USER', gstTreatment: 'GST', confirmedBy: USER,
        });
        expect(first).toEqual({ found: true, hadReviewReason: true });
        const second = await repo().updateCategory(USER, STMT, 3, {
            category: 'Software', categorySource: 'USER', gstTreatment: 'GST', confirmedBy: USER,
        });
        expect(second).toEqual({ found: true, hadReviewReason: false }); // re-confirm is a no-op for counters

        const updated = await repo().getTransaction(USER, STMT, 3);
        expect(updated).toMatchObject({
            category: 'Software', categorySource: 'USER', reviewStatus: 'CONFIRMED', reviewReason: null,
        });
        expect(await repo().updateCategory(USER, STMT, 99, {
            category: 'x', categorySource: 'USER',
        })).toEqual({ found: false, hadReviewReason: false });
        // tenancy: another user cannot touch the row
        expect((await repo().updateCategory('intruder', STMT, 1, {
            category: 'x', categorySource: 'USER',
        })).found).toBe(false);
    });

    it('reprocess wipe + FK cascade on statement delete', async () => {
        expect(await repo().deleteByStatement(STMT)).toBe(3);
        await repo().upsertTransactions([txn(1)]);
        const stmtRepo = new StatementPgRepo(db);
        expect(await stmtRepo.deleteStatement(USER, STMT)).toBe(true);
        const { items } = await repo().listByStatement(USER, STMT);
        expect(items).toHaveLength(0); // cascaded
    });

    it('tallies categories with income/expense split', async () => {
        const stmtRepo = new StatementPgRepo(db);
        const sid = '01STATEMENTSUMMARY00000001';
        await stmtRepo.createStatement({
            statementId: sid, userId: 'tally_user', fy: '2025-26',
            organizationId: 'org_tally', s3Key: `statements/tally_user/2025-26/${sid}.pdf`,
        });
        const t = (seq: number, overrides: Record<string, any>) => ({
            ...txn(seq, overrides), txnId: statementTxnId(sid, seq), statementId: sid, userId: 'tally_user',
        });
        await repo().upsertTransactions([
            t(1, { category: 'SALES', amountCents: 250000, direction: 'CREDIT', gstAmountCents: 22727, reviewStatus: 'CONFIRMED' }),
            t(2, { category: 'SALES', amountCents: 110000, direction: 'CREDIT', gstAmountCents: 10000 }),
            t(3, { category: 'OTHER_INCOME', amountCents: 1500, direction: 'CREDIT' }),
            t(4, { category: 'OFFICE', amountCents: -18000, gstAmountCents: 1636 }),
            t(5, { category: 'OFFICE', amountCents: -2000 }),
            t(6, { category: null }),
        ]);

        const summary = await repo().summariseByCategory({ userId: 'tally_user', fy: '2025-26' });
        const byCat = Object.fromEntries(summary.map((r) => [r.category, r]));

        expect(byCat.SALES).toMatchObject({
            inCents: 360000, outCents: 0, gstCents: 32727, txnCount: 2, confirmedCount: 1,
        });
        expect(byCat.OFFICE).toMatchObject({ inCents: 0, outCents: 20000, gstCents: 1636, txnCount: 2 });
        expect(byCat.OTHER_INCOME).toMatchObject({ inCents: 1500, outCents: 0 });
        expect(byCat.UNCATEGORIZED.txnCount).toBe(1); // null category folded in
        expect(summary[0].category).toBe('SALES');    // biggest magnitude first

        // Org scope (advisor path) sees the same rows; statement scope filters
        const orgSummary = await repo().summariseByCategory({ organizationId: 'org_tally' });
        expect(orgSummary.find((r) => r.category === 'SALES')?.inCents).toBe(360000);
        const single = await repo().summariseByCategory({ userId: 'tally_user', statementId: sid });
        expect(single.reduce((s, r) => s + r.txnCount, 0)).toBe(6);

        // Date-range scope (BAS period views) — txn dates are 2025-08-0X
        const inPeriod = await repo().summariseByCategory({
            userId: 'tally_user', dateFrom: '2025-07-01', dateTo: '2025-09-30',
        });
        expect(inPeriod.reduce((s, r) => s + r.txnCount, 0)).toBe(6);
        const outOfPeriod = await repo().summariseByCategory({
            userId: 'tally_user', dateFrom: '2025-10-01', dateTo: '2025-12-31',
        });
        expect(outOfPeriod).toHaveLength(0);

        await stmtRepo.deleteStatement('tally_user', sid);
    });

    it('tallies deterministic flows, provenance coverage, and transfer rows', async () => {
        const stmtRepo = new StatementPgRepo(db);
        const sid = '01STATEMENTFLOWS0000000001';
        await stmtRepo.createStatement({
            statementId: sid, userId: 'flow_user', fy: '2025-26',
            organizationId: 'org_flow', s3Key: `statements/flow_user/2025-26/${sid}.pdf`,
        });
        const t = (seq: number, overrides: Record<string, any>) => ({
            ...txn(seq, overrides), txnId: statementTxnId(sid, seq), statementId: sid, userId: 'flow_user',
        });
        await repo().upsertTransactions([
            t(1, { flowClass: 'INCOME', category: 'INCOME', categorySource: 'AI', amountCents: 250000, direction: 'CREDIT' }),
            t(2, { flowClass: 'EXPENSE', category: 'OFFICE', categorySource: 'RULE', amountCents: -18000 }),
            t(3, { flowClass: 'TRANSFER', category: 'TRANSFER', categorySource: 'AI', amountCents: -50000, description: 'TRANSFER TO SAVINGS' }),
            t(4, { flowClass: 'TRANSFER', category: 'TRANSFER', categorySource: 'AI', amountCents: 50000, direction: 'CREDIT', description: 'TRANSFER FROM CHEQUE' }),
            t(5, { flowClass: 'REFUND', category: 'INCOME', categorySource: 'USER', amountCents: 4500, direction: 'CREDIT', reviewStatus: 'CONFIRMED' }),
            t(6, { flowClass: null, category: null, categorySource: null, amountCents: -900 }), // pre-column row
        ]);

        const flows = await repo().summariseFlows({ userId: 'flow_user', fy: '2025-26' });
        const byFlow = Object.fromEntries(flows.map((r) => [r.flowClass, r]));
        expect(byFlow.INCOME).toMatchObject({ inCents: 250000, outCents: 0, txnCount: 1 });
        expect(byFlow.EXPENSE).toMatchObject({ inCents: 0, outCents: 18000, txnCount: 1 });
        expect(byFlow.TRANSFER).toMatchObject({ inCents: 50000, outCents: 50000, txnCount: 2 });
        expect(byFlow.REFUND).toMatchObject({ inCents: 4500, outCents: 0, txnCount: 1 });
        expect(byFlow.UNCLASSIFIED).toMatchObject({ outCents: 900, txnCount: 1 });

        const coverage = await repo().summariseCoverage({ userId: 'flow_user', fy: '2025-26' });
        const byBucket = Object.fromEntries(coverage.map((r) => [r.bucket, r]));
        expect(byBucket.AI).toMatchObject({ inCents: 300000, outCents: 50000, txnCount: 3 });
        expect(byBucket.DETERMINISTIC).toMatchObject({ inCents: 4500, outCents: 18000, txnCount: 2, confirmedCount: 1 });
        expect(byBucket.UNCATEGORIZED).toMatchObject({ outCents: 900, txnCount: 1 });

        const transfers = await repo().listTransferRows({ organizationId: 'org_flow' });
        expect(transfers).toHaveLength(2);
        expect(transfers.map((r) => r.amountCents).sort((a, b) => a - b)).toEqual([-50000, 50000]);

        await stmtRepo.deleteStatement('flow_user', sid);
    });

    it('claims prospect rows into a real user', async () => {
        const stmtRepo = new StatementPgRepo(db);
        const prospect = 'prospect#p1';
        const sid = '01STATEMENTPROSPECT0000001';
        await stmtRepo.createStatement({
            statementId: sid, userId: prospect, fy: '2025-26', s3Key: `statements/${prospect}/2025-26/${sid}.pdf`,
        });
        await repo().upsertTransactions([
            { ...txn(1), txnId: statementTxnId(sid, 1), statementId: sid, userId: prospect },
        ]);
        expect(await repo().claimProspectTransactions(prospect, 'user_real')).toBe(1);
        expect(await stmtRepo.claimProspectStatements(prospect, 'user_real', 'org_9')).toBe(1);
        // idempotent re-run
        expect(await repo().claimProspectTransactions(prospect, 'user_real')).toBe(0);
        const claimed = await stmtRepo.getStatement('user_real', sid);
        expect(claimed?.organizationId).toBe('org_9');
        expect((await repo().listByStatement('user_real', sid)).items).toHaveLength(1);
    });
});

describe('cross-statement reconciliation layer', () => {
    const stmtRepo = () => new StatementPgRepo(db);
    const txnRepo = () => new StatementTransactionPgRepo(db);
    const RUSER = 'recon_user';
    const ACCT = `stmt#${RUSER}#anz#4821`;
    const SA = '01STATEMENTRECONA000000001'; // July
    const SB = '01STATEMENTRECONB000000001'; // August (overlapping upload)

    it('stamps accountId and lists an account\'s statements by period', async () => {
        for (const [sid, periodStart, periodEnd] of [
            [SB, '2025-08-01', '2025-08-31'], [SA, '2025-07-01', '2025-07-31'],
        ] as const) {
            await stmtRepo().createStatement({
                statementId: sid, userId: RUSER, fy: '2025-26',
                s3Key: `statements/${RUSER}/2025-26/${sid}.pdf`,
            });
            await stmtRepo().updateStatement(sid, {
                accountId: ACCT, bankName: 'ANZ', accountLast4: '4821', periodStart, periodEnd,
            });
        }
        const stamped = await stmtRepo().getStatement(RUSER, SA);
        expect(stamped?.accountId).toBe(ACCT);

        const siblings = await stmtRepo().listStatementsByAccount(RUSER, ACCT, { excludeStatementId: SB });
        expect(siblings.map((s) => s.statementId)).toEqual([SA]); // self excluded
        const all = await stmtRepo().listStatementsByAccount(RUSER, ACCT);
        expect(all.map((s) => s.statementId)).toEqual([SA, SB]); // periodStart ascending
    });

    it('duplicate rows are excluded from summaries and the dedupe candidate set', async () => {
        const t = (sid: string, seq: number, overrides: Record<string, any>) => ({
            ...txn(seq, overrides), txnId: statementTxnId(sid, seq), statementId: sid, userId: RUSER,
        });
        await txnRepo().upsertTransactions([
            t(SA, 1, { txnDate: '2025-07-30', amountCents: -5000, category: 'OFFICE', flowClass: 'EXPENSE' }),
            t(SA, 2, { txnDate: '2025-07-31', amountCents: 20000, direction: 'CREDIT', category: 'INCOME', flowClass: 'INCOME' }),
        ]);
        // Statement B re-ingests SA#2 (overlapping period) — marked duplicate at ingest.
        await txnRepo().upsertTransactions([
            t(SB, 1, {
                txnDate: '2025-07-31', amountCents: 20000, direction: 'CREDIT',
                category: 'INCOME', flowClass: 'INCOME', duplicateOfTxnId: statementTxnId(SA, 2),
            }),
            t(SB, 2, { txnDate: '2025-08-02', amountCents: -3000, category: 'OFFICE', flowClass: 'EXPENSE' }),
        ]);

        const dup = await txnRepo().getTransaction(RUSER, SB, 1);
        expect(dup?.duplicateOfTxnId).toBe(statementTxnId(SA, 2));

        // Income counted once despite being ingested twice.
        const cats = await txnRepo().summariseByCategory({ userId: RUSER, fy: '2025-26' });
        expect(cats.find((r) => r.category === 'INCOME')).toMatchObject({ inCents: 20000, txnCount: 1 });
        const flows = await txnRepo().summariseFlows({ userId: RUSER, fy: '2025-26' });
        expect(flows.find((r) => r.flowClass === 'INCOME')).toMatchObject({ inCents: 20000, txnCount: 1 });

        // The candidate set for a fresh ingest never contains duplicate rows,
        // and excludes the statement being processed.
        const candidates = await txnRepo().listAccountRowsForDedupe(RUSER, ACCT, {
            dateFrom: '2025-07-01', dateTo: '2025-08-31', excludeStatementId: SB,
        });
        expect(candidates.map((c) => c.txnId)).toEqual([statementTxnId(SA, 1), statementTxnId(SA, 2)]);
        const fromA = await txnRepo().listAccountRowsForDedupe(RUSER, ACCT, {
            dateFrom: '2025-07-01', dateTo: '2025-08-31', excludeStatementId: SA,
        });
        expect(fromA.map((c) => c.txnId)).toEqual([statementTxnId(SB, 2)]); // SB#1 is a duplicate

        // Rows listing still shows the duplicate (annotated, for the review UI).
        expect((await txnRepo().listByStatement(RUSER, SB)).items).toHaveLength(2);
    });

    it('persists transfer pairs on existing legs and filters unpaired transfer rows', async () => {
        const t = (sid: string, seq: number, overrides: Record<string, any>) => ({
            ...txn(seq, overrides), txnId: statementTxnId(sid, seq), statementId: sid, userId: RUSER,
        });
        await txnRepo().upsertTransactions([
            t(SA, 3, { txnDate: '2025-07-15', amountCents: -40000, flowClass: 'TRANSFER', description: 'TRANSFER TO SAVINGS' }),
            t(SB, 3, { txnDate: '2025-08-16', amountCents: 40000, direction: 'CREDIT', flowClass: 'TRANSFER', description: 'TRANSFER FROM CHEQUE' }),
        ]);
        const unpaired = await txnRepo().listTransferRows({ userId: RUSER }, { unpairedOnly: true });
        expect(unpaired).toHaveLength(2);
        expect(unpaired[0].accountId).toBe(ACCT); // joined from the parent statement

        const pairId = statementTxnId(SA, 3);
        await txnRepo().setTransferPairIds([
            { txnId: statementTxnId(SA, 3), transferPairId: pairId },
            { txnId: statementTxnId(SB, 3), transferPairId: pairId },
        ]);
        expect((await txnRepo().getTransaction(RUSER, SA, 3))?.transferPairId).toBe(pairId);
        expect(await txnRepo().listTransferRows({ userId: RUSER }, { unpairedOnly: true })).toHaveLength(0);
        expect(await txnRepo().listTransferRows(
            { userId: RUSER }, { excludeStatementId: SB },
        )).toHaveLength(1);
    });
});
