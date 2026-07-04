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
