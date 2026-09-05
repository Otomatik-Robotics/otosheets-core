import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { statements, statementTransactions } from '../pg/schema/statements';
import { StatementTransactionPgRepo } from './repo.pg';

/**
 * The provenance aggregates, and the one thing they must agree about: a credit
 * attributed to a client by a payer→client link a person made is settled, not
 * model-decided. `BasReportingPgRepo.inputs` counts it reconciled and the
 * unmatched income predicate leaves it off the watchlist, so a coverage rollup
 * calling the same row AI would be a third answer to a settled question.
 */
let db: PgDb;
let repo: StatementTransactionPgRepo;

const D = (s: string) => new Date(s);
const USER = 'u_1';
const ORG = 'org_1';

beforeAll(async () => {
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    repo = new StatementTransactionPgRepo(db);

    await pglite.query(`INSERT INTO orgs (org_id, name) VALUES ('${ORG}', 'Acme')`);
    await db.insert(statements).values({
        statementId: 'stmt_1', userId: USER, organizationId: ORG, fy: '2025-26',
        s3Key: 'k', bankName: 'CBA', accountLast4: '4021',
        createdAt: D('2026-04-01T00:00:00Z'), updatedAt: D('2026-04-01T00:00:00Z'),
    });

    const stx = (o: Record<string, any>) => db.insert(statementTransactions).values({
        userId: USER, statementId: 'stmt_1', fy: '2025-26', direction: 'CREDIT',
        flowClass: 'INCOME', reviewStatus: 'CONFIRMED',
        createdAt: D('2026-04-01T00:00:00Z'), updatedAt: D('2026-04-01T00:00:00Z'), ...o,
    });
    // One row per provenance, plus an uncategorised one and a duplicate.
    await stx({ txnId: 'stmt_1#00001', seq: 1, txnDate: '2026-01-05', description: 'RULE ROW', amountCents: 100000, category: 'INCOME', categorySource: 'RULE' });
    await stx({ txnId: 'stmt_1#00002', seq: 2, txnDate: '2026-01-06', description: 'USER ROW', amountCents: -20000, category: 'TOOLS', categorySource: 'USER', flowClass: 'EXPENSE', direction: 'DEBIT' });
    await stx({ txnId: 'stmt_1#00003', seq: 3, txnDate: '2026-01-07', description: 'ADVISOR ROW', amountCents: -30000, category: 'TOOLS', categorySource: 'ADVISOR', flowClass: 'EXPENSE', direction: 'DEBIT' });
    await stx({ txnId: 'stmt_1#00004', seq: 4, txnDate: '2026-01-08', description: 'SHARED ROW', amountCents: -40000, category: 'FUEL', categorySource: 'SHARED', flowClass: 'EXPENSE', direction: 'DEBIT' });
    // The payer-attributed credit: a person chose the client, the lookup applied it.
    await stx({ txnId: 'stmt_1#00005', seq: 5, txnDate: '2026-01-09', description: 'OSKO PAYMENT BETTERLABS PTY LTD', amountCents: 550000, category: 'INCOME', categorySource: 'PAYER', gstAmountCents: 50000, confirmedBy: 'auto:payer', reviewStatus: 'PENDING' });
    // Its twin, categorised by the model alone.
    await stx({ txnId: 'stmt_1#00006', seq: 6, txnDate: '2026-01-10', description: 'OSKO PAYMENT NORTHSIDE', amountCents: 330000, category: 'INCOME', categorySource: 'AI', gstAmountCents: 30000, reviewStatus: 'PENDING' });
    await stx({ txnId: 'stmt_1#00007', seq: 7, txnDate: '2026-01-11', description: 'UNKNOWN DEPOSIT', amountCents: 60000, category: 'UNCATEGORIZED', categorySource: 'AI' });
    // Duplicates never count toward any summary.
    await stx({ txnId: 'stmt_1#00008', seq: 8, txnDate: '2026-01-12', description: 'RULE ROW', amountCents: 100000, category: 'INCOME', categorySource: 'RULE', duplicateOfTxnId: 'stmt_1#00001' });
});

describe('summariseCoverage', () => {
    const byBucket = async () => {
        const rows = await repo.summariseCoverage({ userId: USER });
        return new Map(rows.map((r) => [r.bucket, r]));
    };

    it('counts a payer-attributed credit as deterministic, not as the model deciding', async () => {
        const buckets = await byBucket();
        expect(buckets.get('DETERMINISTIC')).toMatchObject({
            // RULE + USER + ADVISOR + SHARED + PAYER, credits $1,000 + $5,500.
            txnCount: 5, inCents: 650000, outCents: 90000,
        });
        expect(buckets.get('AI')).toMatchObject({ txnCount: 1, inCents: 330000 });
        expect(buckets.get('UNCATEGORIZED')).toMatchObject({ txnCount: 1, inCents: 60000 });
    });

    it('leaves duplicates out of every bucket', async () => {
        const rows = await repo.summariseCoverage({ userId: USER });
        expect(rows.reduce((n, r) => n + r.txnCount, 0)).toBe(7);
    });

    it('refuses a scope with neither a user nor an org', async () => {
        await expect(repo.summariseCoverage({})).rejects.toThrow(/requires a userId or organizationId/);
    });
});

describe('summariseUncertainGst', () => {
    it('agrees with the coverage rollup: a payer link is confirmation, the model alone is not', async () => {
        const uncertain = await repo.summariseUncertainGst({ userId: USER });
        // Only the AI twin's GST is uncertain; the PAYER row carries GST and is
        // unconfirmed by review status, and is still not counted.
        expect(uncertain).toMatchObject({ rowCount: 1, gstCents: 30000, unconfirmedIncomeGstCents: 30000 });
    });
});
