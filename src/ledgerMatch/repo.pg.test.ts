import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { clients, invoices, invoicePayments } from '../pg/schema/billingCore';
import { receipts } from '../pg/schema/opsEntities';
import { statements, statementTransactions } from '../pg/schema/statements';
import { bankAccounts, bankTransactions } from '../pg/schema/bankFeeds';
import { LedgerMatchPgRepo } from './repo.pg';

let db: PgDb;
let repo: LedgerMatchPgRepo;

const D = (s: string) => new Date(s);
const USER = 'u_1';
const ORG = 'org_1';

beforeAll(async () => {
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    repo = new LedgerMatchPgRepo(db);

    await pglite.query(`INSERT INTO orgs (org_id, name) VALUES ('${ORG}', 'Acme')`);

    await db.insert(clients).values([
        { clientId: 'c_1', orgId: ORG, createdBy: USER, name: 'Acme Pty Ltd', createdAt: D('2026-01-01T00:00:00Z'), updatedAt: D('2026-01-01T00:00:00Z') },
    ]);

    const inv = (o: any) => db.insert(invoices).values({ orgId: ORG, ownerId: USER, createdBy: USER, ...o });
    // Open invoice — the CREDIT candidate.
    await inv({ invoiceId: 'i_open', invoiceNumber: 'INV-0123', clientId: 'c_1', status: 'SENT',
        totalAmount: '550', paidAmount: '0', date: '2026-03-10',
        createdAt: D('2026-03-10T00:00:00Z'), updatedAt: D('2026-03-10T00:00:00Z') });
    // Partially paid — due is total − paid.
    await inv({ invoiceId: 'i_part', invoiceNumber: 'INV-0124', clientId: 'c_1', status: 'PARTIAL',
        totalAmount: '300', paidAmount: '100', date: '2026-03-01',
        createdAt: D('2026-03-01T00:00:00Z'), updatedAt: D('2026-03-01T00:00:00Z') });
    // Settled / quote / payment link — never candidates.
    await inv({ invoiceId: 'i_paid', invoiceNumber: 'INV-0100', clientId: 'c_1', status: 'PAID',
        totalAmount: '900', paidAmount: '900', date: '2026-02-01',
        createdAt: D('2026-02-01T00:00:00Z'), updatedAt: D('2026-02-01T00:00:00Z') });
    await inv({ invoiceId: 'i_quote', invoiceNumber: 'Q-1', clientId: 'c_1', status: 'SENT', isQuote: true,
        totalAmount: '100', paidAmount: '0', date: '2026-03-01',
        createdAt: D('2026-03-01T00:00:00Z'), updatedAt: D('2026-03-01T00:00:00Z') });
    await inv({ invoiceId: 'i_link', invoiceNumber: 'PL-1', clientId: 'c_1', status: 'SENT', isPaymentLink: true,
        totalAmount: '100', paidAmount: '0', date: '2026-03-01',
        createdAt: D('2026-03-01T00:00:00Z'), updatedAt: D('2026-03-01T00:00:00Z') });

    // Payments: i_paid was marked paid by a manual BANK_TRANSFER payment.
    await db.insert(invoicePayments).values({
        paymentId: 'p_1', invoiceId: 'i_paid', orgId: ORG, userId: USER,
        amount: '900', method: 'BANK_TRANSFER', date: '2026-02-05', createdAt: D('2026-02-05T00:00:00Z'),
    });

    // Receipts: r_1 linkable; r_dup a duplicate; r_linked already linked below.
    const rcpt = (o: any) => db.insert(receipts).values({ orgId: ORG, ownerId: USER, createdBy: USER, ...o });
    await rcpt({ receiptId: 'r_1', vendorName: 'Bunnings Warehouse', totalAmount: '89.10', date: '2026-03-21', createdAt: D('2026-03-21T00:00:00Z') });
    await rcpt({ receiptId: 'r_dup', vendorName: 'Bunnings Warehouse', totalAmount: '89.10', date: '2026-03-21', duplicateOf: 'r_1', createdAt: D('2026-03-21T00:00:00Z') });
    await rcpt({ receiptId: 'r_linked', vendorName: 'Officeworks', totalAmount: '45.00', date: '2026-03-05', createdAt: D('2026-03-05T00:00:00Z') });

    // A statement with rows: an old unmatched credit, a matched credit, a
    // transfer leg, a duplicate, and a debit.
    await db.insert(statements).values({
        statementId: 'stmt_1', userId: USER, organizationId: ORG, fy: '2025-26',
        s3Key: 'k', bankName: 'CBA', accountLast4: '4021',
        createdAt: D('2026-04-01T00:00:00Z'), updatedAt: D('2026-04-01T00:00:00Z'),
    });
    const stx = (o: any) => db.insert(statementTransactions).values({
        userId: USER, statementId: 'stmt_1', fy: '2025-26',
        createdAt: D('2026-04-01T00:00:00Z'), updatedAt: D('2026-04-01T00:00:00Z'), ...o,
    });
    await stx({ txnId: 'stmt_1#00001', seq: 1, txnDate: '2026-02-02', description: 'DIRECT CREDIT J&M HOLDINGS', amountCents: 240000, direction: 'CREDIT', flowClass: 'INCOME', reviewStatus: 'CONFIRMED' });
    await stx({ txnId: 'stmt_1#00002', seq: 2, txnDate: '2026-02-09', description: 'EFT CREDIT COASTAL', amountCents: 124000, direction: 'CREDIT', flowClass: 'INCOME', matchedInvoiceId: 'i_paid', matchSource: 'USER', reviewStatus: 'CONFIRMED' });
    await stx({ txnId: 'stmt_1#00003', seq: 3, txnDate: '2026-02-10', description: 'TRANSFER TO SAVINGS', amountCents: 50000, direction: 'CREDIT', flowClass: 'TRANSFER', transferPairId: 'stmt_1#00003', reviewStatus: 'CONFIRMED' });
    await stx({ txnId: 'stmt_1#00004', seq: 4, txnDate: '2026-02-11', description: 'DUP ROW', amountCents: 10000, direction: 'CREDIT', duplicateOfTxnId: 'other#00001', reviewStatus: 'CONFIRMED' });
    await stx({ txnId: 'stmt_1#00005', seq: 5, txnDate: '2026-03-21', description: 'BUNNINGS 636000', amountCents: -8910, direction: 'DEBIT', flowClass: 'EXPENSE', reviewStatus: 'PENDING' });

    // Link r_linked from the statement side so listUnlinkedReceipts excludes it.
    await stx({ txnId: 'stmt_1#00006', seq: 6, txnDate: '2026-03-05', description: 'OFFICEWORKS', amountCents: -4500, direction: 'DEBIT', matchedReceiptId: 'r_linked', matchSource: 'USER', reviewStatus: 'CONFIRMED' });

    // A clean credit reserved for the stamp → unstamp round-trip test.
    await stx({ txnId: 'stmt_1#00007', seq: 7, txnDate: '2026-03-12', description: 'DIRECT CREDIT REF 5521', amountCents: 55000, direction: 'CREDIT', flowClass: 'INCOME', reviewStatus: 'CONFIRMED' });

    // A feed account with an old unmatched credit.
    await db.insert(bankAccounts).values({
        accountId: 'acct_1', userId: USER, organizationId: ORG, institutionName: 'Westpac',
        accountNumberMasked: 'xxxx8330', createdAt: D('2026-01-01T00:00:00Z'), updatedAt: D('2026-01-01T00:00:00Z'),
    });
    await db.insert(bankTransactions).values({
        txnId: 'feed_1', accountId: 'acct_1', userId: USER, organizationId: ORG, fy: '2025-26',
        txnDate: '2026-02-11', description: 'CASH DEPOSIT BRANCH 2214', amountCents: 35000, direction: 'CREDIT',
        reviewStatus: 'CONFIRMED', createdAt: D('2026-02-11T00:00:00Z'), updatedAt: D('2026-02-11T00:00:00Z'),
    });
});

describe('candidate sets', () => {
    it('lists open invoices with cents conversion and live client names', async () => {
        const open = await repo.listOpenInvoicesForMatching(ORG);
        expect(open.map((i) => i.invoiceId).sort()).toEqual(['i_open', 'i_part']);
        const byId = new Map(open.map((i) => [i.invoiceId, i]));
        expect(byId.get('i_open')).toMatchObject({
            invoiceNumber: 'INV-0123', clientName: 'Acme Pty Ltd',
            totalCents: 55000, paidCents: 0, amountDueCents: 55000, issueDate: '2026-03-10',
        });
        expect(byId.get('i_part')!.amountDueCents).toBe(20000);
    });

    it('lists unlinked receipts, excluding duplicates and already-linked ones', async () => {
        const rcpts = await repo.listUnlinkedReceipts(ORG, { dateFrom: '2026-01-01', dateTo: '2026-12-31' });
        expect(rcpts).toHaveLength(1);
        expect(rcpts[0]).toMatchObject({ receiptId: 'r_1', vendorName: 'Bunnings Warehouse', totalCents: 8910, receiptDate: '2026-03-21' });
    });

    it('lists statement rows engine-shaped with exclusion columns intact', async () => {
        const rows = await repo.listStatementRowsForMatching(USER, 'stmt_1');
        expect(rows).toHaveLength(7);
        expect(rows[0]).toMatchObject({ txnId: 'stmt_1#00001', source: 'statement', seq: 1, amountCents: 240000 });
        expect(rows[1].matchedInvoiceId).toBe('i_paid');
        expect(rows[2].transferPairId).toBe('stmt_1#00003');
        expect(rows[3].duplicateOfTxnId).toBe('other#00001');
    });
});

describe('stampMatch', () => {
    it('links, is idempotent on replay, and refuses to repoint', async () => {
        expect(await repo.stampMatch(USER, 'statement', 'stmt_1#00005', { type: 'RECEIPT', id: 'r_1' }, 'USER')).toBe('linked');
        // Replay with the same target — still 'linked', nothing changes.
        expect(await repo.stampMatch(USER, 'statement', 'stmt_1#00005', { type: 'RECEIPT', id: 'r_1' }, 'USER')).toBe('linked');
        // A different target must not silently repoint the link.
        expect(await repo.stampMatch(USER, 'statement', 'stmt_1#00005', { type: 'RECEIPT', id: 'r_linked' }, 'USER')).toBe('conflict');
        expect(await repo.stampMatch(USER, 'statement', 'nope#00001', { type: 'RECEIPT', id: 'r_1' }, 'USER')).toBe('not_found');
        const row = await repo.getRowForMatching(USER, 'statement', 'stmt_1#00005');
        expect(row!.matchedReceiptId).toBe('r_1');
    });

    it('another user cannot stamp my rows', async () => {
        expect(await repo.stampMatch('intruder', 'statement', 'stmt_1#00001', { type: 'INVOICE', id: 'i_open' }, 'USER')).toBe('not_found');
    });
});

describe('unstampMatch', () => {
    it('clears a link, is idempotent on replay, and never unlinks the wrong target', async () => {
        // stamp → unstamp round-trip on a fresh row.
        expect(await repo.stampMatch(USER, 'statement', 'stmt_1#00007', { type: 'INVOICE', id: 'i_open' }, 'AUTO')).toBe('linked');
        // Wrong target id — refuse, the link stays.
        expect(await repo.unstampMatch(USER, 'statement', 'stmt_1#00007', { type: 'INVOICE', id: 'i_part' })).toBe('mismatch');
        expect((await repo.getRowForMatching(USER, 'statement', 'stmt_1#00007'))!.matchedInvoiceId).toBe('i_open');
        // Right target — cleared, and match_source goes with it.
        expect(await repo.unstampMatch(USER, 'statement', 'stmt_1#00007', { type: 'INVOICE', id: 'i_open' })).toBe('cleared');
        const row = await repo.getRowForMatching(USER, 'statement', 'stmt_1#00007');
        expect(row!.matchedInvoiceId).toBeNull();
        // Replay — inert, still 'cleared'.
        expect(await repo.unstampMatch(USER, 'statement', 'stmt_1#00007', { type: 'INVOICE', id: 'i_open' })).toBe('cleared');
        // The freed row can be stamped again (undo really frees the target).
        expect(await repo.stampMatch(USER, 'statement', 'stmt_1#00007', { type: 'INVOICE', id: 'i_part' }, 'USER')).toBe('linked');
    });

    it('another user cannot unstamp my rows', async () => {
        expect(await repo.unstampMatch('intruder', 'statement', 'stmt_1#00007', { type: 'INVOICE', id: 'i_part' })).toBe('not_found');
    });
});

describe('rejections', () => {
    it('persists dismissals idempotently and lists them per txn set', async () => {
        await repo.rejectMatch(USER, 'stmt_1#00001', 'INVOICE', 'i_open');
        await repo.rejectMatch(USER, 'stmt_1#00001', 'INVOICE', 'i_open'); // replay — no throw
        const rej = await repo.listRejections(USER, ['stmt_1#00001', 'stmt_1#00002']);
        expect(rej).toEqual([{ txnId: 'stmt_1#00001', targetType: 'INVOICE', targetId: 'i_open' }]);
    });
});

describe('listUnmatchedIncome', () => {
    it('returns old unexplained credits from both sources with account labels + total', async () => {
        const page = await repo.listUnmatchedIncome(USER, { olderThan: '2026-03-01' });
        // stmt_1#00001 (unmatched credit) + feed_1; matched/transfer/duplicate rows excluded.
        expect(page.items.map((r) => r.txnId)).toEqual(['stmt_1#00001', 'feed_1']);
        expect(page.items[0]).toMatchObject({ source: 'statement', statementId: 'stmt_1', seq: 1, accountLabel: 'CBA •• 4021', amountCents: 240000 });
        expect(page.items[1]).toMatchObject({ source: 'feed', accountId: 'acct_1', accountLabel: 'Westpac •• 8330' });
        expect(page.totalCount).toBe(2);
        expect(page.nextToken).toBeNull();
    });

    it('respects the cutoff — nothing newer than olderThan', async () => {
        const page = await repo.listUnmatchedIncome(USER, { olderThan: '2026-02-01' });
        expect(page.items).toHaveLength(0);
        expect(page.totalCount).toBe(0);
    });

    it('paginates with a keyset token', async () => {
        const first = await repo.listUnmatchedIncome(USER, { olderThan: '2026-03-01', limit: 1 });
        expect(first.items.map((r) => r.txnId)).toEqual(['stmt_1#00001']);
        expect(first.totalCount).toBe(2);
        expect(first.nextToken).not.toBeNull();
        const second = await repo.listUnmatchedIncome(USER, { olderThan: '2026-03-01', limit: 1, nextToken: first.nextToken });
        expect(second.items.map((r) => r.txnId)).toEqual(['feed_1']);
        expect(second.nextToken).toBeNull();
    });

    it('filters bank-account noise that is never invoice income', async () => {
        const stx = (o: any) => db.insert(statementTransactions).values({
            userId: USER, statementId: 'stmt_1', fy: '2025-26', direction: 'CREDIT',
            flowClass: 'INCOME', reviewStatus: 'CONFIRMED',
            createdAt: D('2026-04-01T00:00:00Z'), updatedAt: D('2026-04-01T00:00:00Z'), ...o,
        });
        await stx({ txnId: 'stmt_1#00050', seq: 50, txnDate: '2026-01-05', description: 'Credit Interest', amountCents: 6300 });
        await stx({ txnId: 'stmt_1#00051', seq: 51, txnDate: '2026-01-06', description: 'Direct Credit 364049 The S&C Perth Di Payroll 1200', amountCents: 981200 });
        await stx({ txnId: 'stmt_1#00052', seq: 52, txnDate: '2026-01-07', description: 'Return 13/01/26 Direct Debit 372582 Nissan Financial', amountCents: 47644 });
        await stx({ txnId: 'stmt_1#00053', seq: 53, txnDate: '2026-01-08', description: 'Interest Payment (effective 01 Feb)', amountCents: 220 });
        await stx({ txnId: 'stmt_1#00054', seq: 54, txnDate: '2026-01-09', description: 'OSKO DEPOSIT REF 4471', amountCents: 900 }); // under $50 floor
        await stx({ txnId: 'stmt_1#00055', seq: 55, txnDate: '2026-01-10', description: 'CASH DEPOSIT CBA ATM MIDLAND', amountCents: 120000 }); // stays — takings need explaining
        // Human-explained: user deliberately categorised it as other income.
        await stx({ txnId: 'stmt_1#00056', seq: 56, txnDate: '2026-01-11', description: 'DIRECT CREDIT SIDE GIG', amountCents: 50000, category: 'INCOME', categorySource: 'USER' });

        const page = await repo.listUnmatchedIncome(USER, { olderThan: '2026-03-01' });
        expect(page.items.map((r) => r.txnId)).toEqual(['stmt_1#00055', 'stmt_1#00001', 'feed_1']);
        expect(page.totalCount).toBe(3);
    });
});

describe('chip info', () => {
    it('returns live invoice + receipt facts for matched-chip rendering', async () => {
        const [inv] = await repo.listInvoiceChips(ORG, ['i_paid']);
        expect(inv).toMatchObject({ invoiceId: 'i_paid', invoiceNumber: 'INV-0100', clientName: 'Acme Pty Ltd', status: 'PAID', totalCents: 90000 });
        const [rcpt] = await repo.listReceiptChips(ORG, ['r_linked']);
        expect(rcpt).toMatchObject({ receiptId: 'r_linked', vendorName: 'Officeworks', totalCents: 4500, receiptDate: '2026-03-05' });
        expect(await repo.listInvoiceChips(ORG, [])).toEqual([]);
    });
});

describe('depositCheckForInvoices', () => {
    it('reports bank-match state and latest BANK_TRANSFER payment date', async () => {
        const checks = await repo.depositCheckForInvoices(ORG, ['i_paid', 'i_open']);
        const byId = new Map(checks.map((c) => [c.invoiceId, c]));
        // i_paid is linked from stmt_1#00002 AND has a bank-transfer payment.
        expect(byId.get('i_paid')).toMatchObject({ bankMatched: true, lastBankTransferPaymentDate: '2026-02-05' });
        expect(byId.get('i_open')).toMatchObject({ bankMatched: false, lastBankTransferPaymentDate: null });
    });

    it('returns nothing for an empty id set', async () => {
        expect(await repo.depositCheckForInvoices(ORG, [])).toEqual([]);
    });
});
