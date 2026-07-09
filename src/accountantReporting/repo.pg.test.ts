import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { invoices, receipts, statements, statementTransactions } from '../pg/schema';
import { AccountantReportingPgRepo } from './repo.pg';

let db: PgDb;
const ORG = 'org_agg';

beforeAll(async () => {
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    await pglite.query("INSERT INTO orgs (org_id, name) VALUES ('org_agg', 'Silk Rd Pty')");
    await pglite.query("INSERT INTO orgs (org_id, name) VALUES ('org_other', 'Someone Else')");

    const inv = (o: any) => db.insert(invoices).values({ orgId: ORG, ownerId: 'u_1', createdBy: 'u_1', ...o });
    // i_1: paid, June
    await inv({ invoiceId: 'i_1', invoiceNumber: 'INV-1', status: 'PAID', totalAmount: '1000', paidAmount: '1000', gstAmount: '90', date: '2026-06-01' });
    // i_2: unpaid, August
    await inv({ invoiceId: 'i_2', invoiceNumber: 'INV-2', status: 'SENT', totalAmount: '500', paidAmount: '0', gstAmount: '45', date: '2026-08-10' });
    // payment link — excluded from income + counts
    await inv({ invoiceId: 'i_pl', invoiceNumber: 'PL-1', status: 'SENT', totalAmount: '9999', paidAmount: '0', gstAmount: '900', date: '2026-06-15', isPaymentLink: true });
    // other org — must never leak
    await db.insert(invoices).values({ orgId: 'org_other', ownerId: 'u_x', createdBy: 'u_x', invoiceId: 'i_x', invoiceNumber: 'X', status: 'PAID', totalAmount: '7777', paidAmount: '7777', gstAmount: '700', date: '2026-06-02' });

    const rec = (o: any) => db.insert(receipts).values({ orgId: ORG, ownerId: 'u_1', createdBy: 'u_1', ...o });
    // r_1: full business use, June
    await rec({ receiptId: 'r_1', status: 'ACTIVE', totalAmount: '200', gstAmount: '20', businessPercent: '100', date: '2026-06-05' });
    // r_2: 50% business use, August → 50 expense / 5 gst credit
    await rec({ receiptId: 'r_2', status: 'ACTIVE', totalAmount: '100', gstAmount: '10', businessPercent: '50', date: '2026-08-01' });
    // r_arch: ARCHIVED — excluded
    await rec({ receiptId: 'r_arch', status: 'ARCHIVED', totalAmount: '999', gstAmount: '90', businessPercent: '100', date: '2026-06-09' });

    await db.insert(statements).values({ statementId: 's_1', organizationId: ORG, userId: 'u_1', fy: '2026-27', s3Key: 's3/s_1.pdf', status: 'PROCESSED' } as any);
    const tx = (seq: number, o: any) => db.insert(statementTransactions).values({
        txnId: `s_1#${String(seq).padStart(5, '0')}`, statementId: 's_1', userId: 'u_1', fy: '2026-27', seq, ...o,
    } as any);
    await tx(1, { txnDate: '2026-06-03', amountCents: 250000, direction: 'CREDIT' });
    await tx(2, { txnDate: '2026-08-02', amountCents: -18000, direction: 'DEBIT' });
});

describe('AccountantReportingPgRepo.clientAggregate', () => {
    it('rolls up the whole client lifetime (no date bounds)', async () => {
        const a = await new AccountantReportingPgRepo(db).clientAggregate({ orgId: ORG });
        expect(a.income).toBe(1500);          // 1000 + 500; payment link excluded
        expect(a.incomeCollected).toBe(1000);
        expect(a.invoicesIssued).toBe(2);
        expect(a.invoicesPaid).toBe(1);
        expect(a.expenses).toBe(250);         // 200 + 100*0.5; archived excluded
        expect(a.expensesCount).toBe(2);
        expect(a.net).toBe(1250);
        expect(a.marginPct).toBe(83);
        expect(a.gstCollected).toBe(135);     // 90 + 45
        expect(a.gstCredits).toBe(25);        // 20 + 5
        expect(a.gstNet).toBe(110);
        expect(a.statementsCount).toBe(1);
        expect(a.statementTxns).toBe(2);
        expect(a.statementsNet).toBe(2320);   // (250000 - 18000) / 100
        expect(a.firstRecordDate).toBe('2026-06-01');
    });

    it('scopes every figure to a date range', async () => {
        const a = await new AccountantReportingPgRepo(db).clientAggregate({ orgId: ORG, dateFrom: '2026-06-01', dateTo: '2026-06-30' });
        expect(a.income).toBe(1000);          // only i_1
        expect(a.invoicesIssued).toBe(1);
        expect(a.expenses).toBe(200);         // only r_1
        expect(a.expensesCount).toBe(1);
        expect(a.net).toBe(800);
        expect(a.gstNet).toBe(70);            // 90 - 20
        expect(a.statementTxns).toBe(1);      // only the June credit
        expect(a.statementsNet).toBe(2500);
    });

    it('never leaks another org', async () => {
        const a = await new AccountantReportingPgRepo(db).clientAggregate({ orgId: 'org_other' });
        expect(a.income).toBe(7777);
        expect(a.expenses).toBe(0);
    });
});
