import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { invoices, invoicePayments } from '../pg/schema/billingCore';
import { receipts, trips } from '../pg/schema/opsEntities';
import { statements, statementTransactions } from '../pg/schema/statements';
import { bankAccounts, bankTransactions } from '../pg/schema/bankFeeds';
import { assets } from '../pg/schema/bookkeeping';
import { BasReportingPgRepo, monthsInWindow, monthsCoveredBy } from './inputs.pg';
import { composeConfidence } from './confidence';

let db: PgDb;
let repo: BasReportingPgRepo;

const D = (s: string) => new Date(s);
const ORG = 'org_1';
const USER = 'u_1';
const WINDOW = { dateFrom: '2026-07-01', dateTo: '2026-08-31' };

beforeAll(async () => {
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    repo = new BasReportingPgRepo(db);

    // Five orgs: the fixture org, one with a live feed and nothing else, one
    // empty, one whose only account came from a statement upload (no statements
    // in the window), and one with such an account plus a July statement.
    await pglite.query(`INSERT INTO orgs (org_id, name) VALUES ('${ORG}', 'Acme'), ('org_a', 'Feed Co'), ('org_b', 'Empty Co'), ('org_c', 'Stmt Acct Co'), ('org_d', 'Stmt July Co')`);

    // ── Invoices ──
    const inv = (o: Record<string, any>) => db.insert(invoices).values({
        orgId: ORG, ownerId: USER, createdBy: USER, createdAt: D('2026-07-01T00:00:00Z'), updatedAt: D('2026-07-01T00:00:00Z'), ...o,
    });
    await inv({ invoiceId: 'i_sent', invoiceNumber: 'INV-1', status: 'SENT', date: '2026-07-10', subtotal: '1000', gstAmount: '100', totalAmount: '1100', paidAmount: '0' });
    await inv({ invoiceId: 'i_draft', invoiceNumber: 'INV-2', status: 'DRAFT', date: '2026-07-11', subtotal: '999', gstAmount: '99.9', totalAmount: '1098.9' });
    await inv({ invoiceId: 'i_void', invoiceNumber: 'INV-3', status: 'VOID', date: '2026-07-12', subtotal: '999', gstAmount: '99.9', totalAmount: '1098.9' });
    await inv({ invoiceId: 'i_paid_bank', invoiceNumber: 'INV-4', status: 'PAID', date: '2026-07-15', subtotal: '500', gstAmount: '50', totalAmount: '550', paidAmount: '550' });
    await inv({ invoiceId: 'i_paid_cash', invoiceNumber: 'INV-5', status: 'PAID', date: '2026-08-02', subtotal: '200', gstAmount: '20', totalAmount: '220', paidAmount: '220' });
    await inv({ invoiceId: 'i_paid_stripe', invoiceNumber: 'INV-6', status: 'PAID', date: '2026-08-03', subtotal: '300', gstAmount: '30', totalAmount: '330', paidAmount: '330', stripeSessionId: 'cs_test_1' });
    await inv({ invoiceId: 'i_paid_pi', invoiceNumber: 'INV-7', status: 'PARTIAL', date: '2026-08-04', subtotal: '400', gstAmount: '40', totalAmount: '440', paidAmount: '100' });
    await db.insert(invoicePayments).values({
        paymentId: 'p_pi', invoiceId: 'i_paid_pi', orgId: ORG, userId: USER, amount: '100', method: 'STRIPE',
        date: '2026-08-05', stripePaymentIntentId: 'pi_1', createdAt: D('2026-08-05T00:00:00Z'),
    });
    await inv({ invoiceId: 'i_quote', invoiceNumber: 'Q-1', status: 'SENT', isQuote: true, date: '2026-07-20', subtotal: '5000', gstAmount: '500', totalAmount: '5500' });
    await inv({ invoiceId: 'i_recurring', invoiceNumber: 'R-1', status: 'SENT', isRecurring: true, date: '2026-07-20', subtotal: '5000', gstAmount: '500', totalAmount: '5500' });
    await inv({ invoiceId: 'i_link', invoiceNumber: 'PL-1', status: 'PAID', isPaymentLink: true, date: '2026-07-20', subtotal: '50', gstAmount: '5', totalAmount: '55' });
    await inv({ invoiceId: 'i_old', invoiceNumber: 'INV-0', status: 'SENT', date: '2026-06-30', subtotal: '5000', gstAmount: '500', totalAmount: '5500' });

    // ── Receipts ──
    const rcpt = (o: Record<string, any>) => db.insert(receipts).values({
        orgId: ORG, ownerId: USER, createdBy: USER, status: 'PROCESSED', createdAt: D('2026-07-01T00:00:00Z'), ...o,
    });
    const opened = { openedAt: D('2026-08-01T00:00:00Z'), openedBy: USER, categoryConfirmedAt: D('2026-08-01T00:00:00Z'), categoryConfirmedBy: USER };
    await rcpt({ receiptId: 'r_ok', date: '2026-07-05', totalAmount: '110', taxAmount: '10', category: 'TOOLS', businessPercent: '100', ...opened });
    await rcpt({ receiptId: 'r_arch_dup', date: '2026-07-05', totalAmount: '110', taxAmount: '10', category: 'TOOLS', status: 'ARCHIVED', duplicateOf: 'r_ok' });
    await rcpt({ receiptId: 'r_dup', date: '2026-07-05', totalAmount: '110', taxAmount: '10', category: 'TOOLS', status: 'DUPLICATE', duplicateOf: 'r_ok' });
    await rcpt({ receiptId: 'r_high', date: '2026-07-20', totalAmount: '55', taxAmount: '5', category: 'FUEL', businessPercent: '50', aiRiskLevel: 'HIGH' });
    await rcpt({ receiptId: 'r_high_acked', date: '2026-07-21', totalAmount: '22', taxAmount: '2', category: 'FUEL', aiRiskLevel: 'HIGH', reviewedAt: D('2026-07-22T00:00:00Z'), reviewedBy: USER, ...opened });
    await rcpt({ receiptId: 'r_asset', date: '2026-08-01', totalAmount: '3300', taxAmount: '300', category: 'COMPUTER', assetId: 'a_1', ...opened });
    await rcpt({ receiptId: 'r_uncat', date: '2026-08-05', totalAmount: '0', category: 'UNCATEGORIZED' });
    await rcpt({ receiptId: 'r_old', date: '2026-06-01', totalAmount: '1000', taxAmount: '90.91', category: 'TOOLS' });

    // ── Trips ──
    const trip = (o: Record<string, any>) => db.insert(trips).values({ orgId: ORG, ownerId: USER, createdBy: USER, createdAt: D('2026-07-01T00:00:00Z'), ...o });
    await trip({ tripId: 't_1', date: '2026-07-08', distanceKm: '12.5', purpose: 'WORK' });
    await trip({ tripId: 't_2', date: '2026-08-20', distanceKm: '7.5', purpose: 'WORK' });
    // In the window, but not a business trip: the deduction must not claim it.
    await trip({ tripId: 't_personal', date: '2026-08-21', distanceKm: '40', purpose: 'PERSONAL' });
    // In the window with no purpose recorded: unverified, so also not claimed.
    await trip({ tripId: 't_unset', date: '2026-08-22', distanceKm: '30' });
    await trip({ tripId: 't_old', date: '2026-06-01', distanceKm: '99', purpose: 'WORK' });

    // ── Statements: July covered; a duplicate statement covering August is ignored. ──
    await db.insert(statements).values([
        { statementId: 'stmt_1', userId: USER, organizationId: ORG, fy: '2026-27', s3Key: 'k', periodStart: '2026-07-01', periodEnd: '2026-07-31', createdAt: D('2026-08-01T00:00:00Z'), updatedAt: D('2026-08-01T00:00:00Z') },
        { statementId: 'stmt_dup', userId: USER, organizationId: ORG, fy: '2026-27', s3Key: 'k2', periodStart: '2026-08-01', periodEnd: '2026-08-31', duplicateOfStatementId: 'stmt_x', createdAt: D('2026-09-01T00:00:00Z'), updatedAt: D('2026-09-01T00:00:00Z') },
    ]);
    const stx = (o: Record<string, any>) => db.insert(statementTransactions).values({
        userId: USER, statementId: 'stmt_1', fy: '2026-27', createdAt: D('2026-08-01T00:00:00Z'), updatedAt: D('2026-08-01T00:00:00Z'), ...o,
    });
    await stx({ txnId: 's1', seq: 1, txnDate: '2026-07-15', description: 'EFT CREDIT ACME', amountCents: 55000, direction: 'CREDIT', flowClass: 'INCOME', matchedInvoiceId: 'i_paid_bank', matchSource: 'USER', reviewStatus: 'CONFIRMED' });
    await stx({ txnId: 's2', seq: 2, txnDate: '2026-07-16', description: 'DIRECT CREDIT J&M', amountCents: 80000, direction: 'CREDIT', flowClass: 'INCOME', reviewStatus: 'PENDING' });
    await stx({ txnId: 's3', seq: 3, txnDate: '2026-07-17', description: 'BUNNINGS', amountCents: -8910, direction: 'DEBIT', flowClass: 'EXPENSE', reviewStatus: 'PENDING' });
    await stx({ txnId: 's4', seq: 4, txnDate: '2026-07-18', description: 'TELSTRA', amountCents: -2000, direction: 'DEBIT', flowClass: 'EXPENSE', reviewStatus: 'CONFIRMED', categorySource: 'USER', category: 'PHONE' });
    await stx({ txnId: 's5', seq: 5, txnDate: '2026-07-19', description: 'DUP', amountCents: 3000, direction: 'CREDIT', duplicateOfTxnId: 'other#1', reviewStatus: 'CONFIRMED' });
    await stx({ txnId: 's6', seq: 6, txnDate: '2026-07-20', description: 'TRANSFER FROM SAVINGS', amountCents: 50000, direction: 'CREDIT', flowClass: 'TRANSFER', transferPairId: 's6', reviewStatus: 'CONFIRMED' });
    await stx({ txnId: 's7', seq: 7, txnDate: '2026-07-21', description: 'INTEREST', amountCents: 3000, direction: 'CREDIT', flowClass: 'INCOME', reviewStatus: 'PENDING' }); // under $50 + noise
    await stx({ txnId: 's8', seq: 8, txnDate: '2026-09-01', description: 'OUT OF WINDOW', amountCents: 99900, direction: 'CREDIT', flowClass: 'INCOME', reviewStatus: 'PENDING' });

    // ── A disconnected feed account with one August row: rows count, but the feed is not "active". ──
    await db.insert(bankAccounts).values({ accountId: 'acct_off', userId: USER, organizationId: ORG, status: 'DISCONNECTED', createdAt: D('2026-01-01T00:00:00Z'), updatedAt: D('2026-01-01T00:00:00Z') });
    await db.insert(bankTransactions).values({
        txnId: 'f1', accountId: 'acct_off', userId: USER, organizationId: ORG, fy: '2026-27', txnDate: '2026-08-10',
        description: 'CASH DEPOSIT', amountCents: 12000, direction: 'CREDIT', reviewStatus: 'PENDING',
        createdAt: D('2026-08-10T00:00:00Z'), updatedAt: D('2026-08-10T00:00:00Z'),
    });

    // ── org_a: a live feed, nothing else. ──
    await db.insert(bankAccounts).values({ accountId: 'acct_live', userId: 'u_a', organizationId: 'org_a', status: 'ACTIVE', createdAt: D('2026-01-01T00:00:00Z'), updatedAt: D('2026-01-01T00:00:00Z') });

    // ── org_c: the account row statement ingest creates (provider 'statement', left ACTIVE) and no statements. ──
    await db.insert(bankAccounts).values({ accountId: 'acct_stmt_c', userId: 'u_c', organizationId: 'org_c', provider: 'statement', status: 'ACTIVE', institutionName: 'CBA', accountNumberMasked: '4021', createdAt: D('2026-01-01T00:00:00Z'), updatedAt: D('2026-01-01T00:00:00Z') });

    // ── org_d: the same account row plus one statement covering July. ──
    await db.insert(bankAccounts).values({ accountId: 'acct_stmt_d', userId: 'u_d', organizationId: 'org_d', provider: 'statement', status: 'ACTIVE', institutionName: 'CBA', accountNumberMasked: '4022', createdAt: D('2026-01-01T00:00:00Z'), updatedAt: D('2026-01-01T00:00:00Z') });
    await db.insert(statements).values({ statementId: 'stmt_d', userId: 'u_d', organizationId: 'org_d', fy: '2026-27', s3Key: 'kd', periodStart: '2026-07-01', periodEnd: '2026-07-31', createdAt: D('2026-08-01T00:00:00Z'), updatedAt: D('2026-08-01T00:00:00Z') });

    // ── Assets ──
    const asset = (o: Record<string, any>) => db.insert(assets).values({
        orgId: ORG, ownerId: USER, name: 'x', category: 'TOOLS', priceIncGst: '100', purchaseDate: '2026-07-01',
        createdAt: D('2026-07-01T00:00:00Z'), updatedAt: D('2026-07-01T00:00:00Z'), ...o,
    });
    await asset({ assetId: 'a_1', firstUsedDate: null });
    await asset({ assetId: 'a_2', firstUsedDate: '2026-07-02' });
    await asset({ assetId: 'a_3', firstUsedDate: null, status: 'DISPOSED' });
});

describe('window helpers', () => {
    it('monthsInWindow lists every overlapping calendar month, across a year boundary', () => {
        expect(monthsInWindow('2026-07-01', '2026-08-31')).toEqual(['2026-07', '2026-08']);
        expect(monthsInWindow('2026-10-01', '2027-03-31')).toEqual(['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
        expect(monthsInWindow('2026-07-15', '2026-07-16')).toEqual(['2026-07']);
        expect(monthsInWindow('bad', 'worse')).toEqual([]);
    });

    it('monthsCoveredBy marks a month covered when any period overlaps it', () => {
        const months = ['2026-07', '2026-08', '2026-09'];
        expect([...monthsCoveredBy(months, [{ start: '2026-07-01', end: '2026-07-31' }])]).toEqual(['2026-07']);
        expect([...monthsCoveredBy(months, [{ start: '2026-07-20', end: '2026-08-19' }])]).toEqual(['2026-07', '2026-08']);
        expect([...monthsCoveredBy(months, [{ start: '2026-06-01', end: '2026-06-30' }])]).toEqual([]);
        expect([...monthsCoveredBy(months, [{ start: '2026-08-31', end: '2026-08-31' }])]).toEqual(['2026-08']);
    });
});

describe('BasReportingPgRepo.inputs', () => {
    it('folds the fixture into the expected inputs', async () => {
        const got = await repo.inputs({ orgId: ORG, ...WINDOW });

        expect(got.window).toEqual(WINDOW);

        // Real invoices in window: i_sent, i_paid_bank, i_paid_cash, i_paid_stripe, i_paid_pi.
        expect(got.invoices).toEqual({
            count: 5,
            gstCollected: 240,
            salesExGst: 2400,
            paidCount: 4,
            paidWithoutBankCredit: 1,          // i_paid_cash: no bank credit, no Stripe evidence
            paidWithoutBankCreditIds: ['i_paid_cash'],
        });

        // Receipts in window: r_ok, r_high, r_high_acked, r_asset, r_uncat (archived/duplicate/old excluded).
        expect(got.receipts).toEqual({
            count: 5,
            gstPaid: 314.5,                     // 10 + 5×50% + 2 + 300 + 0
            capitalGstPaid: 300,                // r_asset alone, at 100% business use
            nonCapitalCount: 4,                 // every receipt in the window except r_asset
            expensesExGst: 145,                 // 100 + 50×50% + 20 + 0   (r_asset is capital)
            capitalExGst: 3000,
            unreviewed: 2,                      // r_high (not opened, HIGH), r_uncat (not opened, uncategorised, no amount)
            notOpened: 2,
            categoryUnconfirmed: 2,
            inException: 2,                     // r_high, r_uncat — r_high_acked's flag is acknowledged
            exception: { possibleDuplicate: 0, extractionFailed: 0, highRisk: 1, uncategorised: 1, noAmount: 1 },
        });

        // t_1 + t_2 only: the personal trip, the trip with no purpose and the
        // trip before the window are all out.
        expect(got.trips).toEqual({ count: 2, km: 20 });

        // July covered by stmt_1; August's only statement is a duplicate; the feed is disconnected.
        expect(got.bank).toEqual({
            hasStatement: true,
            feedActive: false,
            monthsInWindow: 2,
            monthsCovered: 1,
            monthsMissing: ['2026-08'],
            statements: 1,                      // stmt_1 covers July; stmt_dup is a duplicate
            rowsTotal: 6,                       // s1 s2 s3 s4 s7 + f1 (s5 dup, s6 transfer, s8 out of window)
            unreconciledRows: 4,                // s2 s3 s7 f1
            unmatchedCredits: 2,                // s2 + f1 (s7 is interest and under $50)
            unmatchedCreditsAmount: 920,
        });

        expect(got.assets).toEqual({ count: 2, withoutFirstUse: 1 });

        // The fixture's confidence: a statement exists but a paid invoice has no bank credit → 50.
        const c = composeConfidence(got);
        expect(c.score).toBe(50);
        expect(c.reasons.map((r) => r.code)).toEqual([
            'INVOICES_UNATTRIBUTED', 'MONTH_MISSING', 'BANK_ROWS_UNRECONCILED',
            'CREDITS_UNMATCHED', 'RECEIPTS_UNREVIEWED', 'ASSETS_NO_FIRST_USE',
        ]);
    });

    it('a live feed covers every month; an empty org has no bank record at all', async () => {
        const feed = await repo.inputs({ orgId: 'org_a', ...WINDOW });
        expect(feed.bank).toMatchObject({ hasStatement: true, feedActive: true, monthsCovered: 2, monthsMissing: [], rowsTotal: 0, statements: 0 });
        expect(composeConfidence(feed)).toEqual({ score: 100, reasons: [] });

        const empty = await repo.inputs({ orgId: 'org_b', ...WINDOW });
        expect(empty.bank).toMatchObject({ hasStatement: false, feedActive: false, monthsCovered: 0, monthsMissing: ['2026-07', '2026-08'], statements: 0 });
        expect(empty.invoices.count).toBe(0);
        expect(empty.receipts.count).toBe(0);
        expect(composeConfidence(empty).score).toBe(50);
        expect(composeConfidence(empty).reasons[0].code).toBe('NO_STATEMENT');
    });

    it('an account created by a statement upload is not a feed: nothing covers the window until a statement does', async () => {
        // org_c has the bank_accounts row every statement upload leaves behind
        // and no statements in the window. It used to read as a live feed, so
        // every month counted as covered and NO_STATEMENT never fired.
        const none = await repo.inputs({ orgId: 'org_c', ...WINDOW });
        expect(none.bank).toMatchObject({
            hasStatement: false, feedActive: false, monthsInWindow: 2, monthsCovered: 0,
            monthsMissing: ['2026-07', '2026-08'], statements: 0,
        });
        expect(composeConfidence(none).reasons[0].code).toBe('NO_STATEMENT');

        // org_d: the same account row plus a July statement covers July only.
        const july = await repo.inputs({ orgId: 'org_d', ...WINDOW });
        expect(july.bank).toMatchObject({
            hasStatement: true, feedActive: false, monthsCovered: 1, monthsMissing: ['2026-08'], statements: 1,
        });
        expect(composeConfidence(july).reasons.map((r) => r.code)).toContain('MONTH_MISSING');
        expect(composeConfidence(july).reasons.map((r) => r.code)).not.toContain('NO_STATEMENT');
    });

    it('is strictly org-scoped', async () => {
        const other = await repo.inputs({ orgId: 'org_b', ...WINDOW });
        expect(other.trips).toEqual({ count: 0, km: 0 });
        expect(other.assets).toEqual({ count: 0, withoutFirstUse: 0 });
        expect(other.bank.rowsTotal).toBe(0);
    });
});

describe('BasReportingPgRepo.listOrgIdsPaged', () => {
    it('walks every org two at a time and stops with a null cursor', async () => {
        const p1 = await repo.listOrgIdsPaged({ limit: 2 });
        expect(p1).toEqual({ orgIds: ['org_1', 'org_a'], nextAfterOrgId: 'org_a' });
        const p2 = await repo.listOrgIdsPaged({ limit: 2, afterOrgId: p1.nextAfterOrgId });
        expect(p2).toEqual({ orgIds: ['org_b', 'org_c'], nextAfterOrgId: 'org_c' });
        const p3 = await repo.listOrgIdsPaged({ limit: 2, afterOrgId: p2.nextAfterOrgId });
        expect(p3).toEqual({ orgIds: ['org_d'], nextAfterOrgId: null });
    });

    it('clamps the limit and reports no next page when the last page is exactly full', async () => {
        const all = await repo.listOrgIdsPaged({ limit: 5000 });
        expect(all).toEqual({ orgIds: ['org_1', 'org_a', 'org_b', 'org_c', 'org_d'], nextAfterOrgId: null });
        const exact = await repo.listOrgIdsPaged({ limit: 5 });
        expect(exact.nextAfterOrgId).toBeNull();
        const one = await repo.listOrgIdsPaged({ limit: 0 });
        expect(one).toEqual({ orgIds: ['org_1'], nextAfterOrgId: 'org_1' });
    });
});
