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

    it('a credit attributed to a known client (PAYER) has a client and is not unmatched', async () => {
        const stx = (o: any) => db.insert(statementTransactions).values({
            userId: USER, statementId: 'stmt_1', fy: '2025-26', direction: 'CREDIT',
            flowClass: 'INCOME', reviewStatus: 'CONFIRMED',
            createdAt: D('2026-04-01T00:00:00Z'), updatedAt: D('2026-04-01T00:00:00Z'), ...o,
        });
        // Attributed at ingest (payer alias hit) and by a later link alike:
        // category_source PAYER, confirmed by the machine, no invoice yet.
        await stx({ txnId: 'stmt_1#00057', seq: 57, txnDate: '2026-01-12', description: 'OSKO PAYMENT BETTERLABS PTY LTD', amountCents: 1108594, category: 'INCOME', categorySource: 'PAYER', confirmedBy: 'auto:payer' });
        // A feed row attributed the same way leaves too: both sources share the definition.
        await db.insert(bankTransactions).values({
            txnId: 'feed_payer', accountId: 'acct_1', userId: USER, organizationId: ORG, fy: '2025-26',
            txnDate: '2026-01-13', description: 'OSKO PAYMENT BETTERLABS PTY LTD', amountCents: 1206563, direction: 'CREDIT',
            category: 'INCOME', categorySource: 'PAYER', reviewStatus: 'CONFIRMED', confirmedBy: 'auto:payer',
            createdAt: D('2026-01-13T00:00:00Z'), updatedAt: D('2026-01-13T00:00:00Z'),
        });

        const page = await repo.listUnmatchedIncome(USER, { olderThan: '2026-03-01' });
        expect(page.items.map((r) => r.txnId)).toEqual(['stmt_1#00055', 'stmt_1#00001', 'feed_1']);
        expect(page.totalCount).toBe(3);
    });

    it('a feed credit whose descriptor names own-money movement is not unmatched income', async () => {
        // The statement side gates on the flow class the ingest derived
        // (stmt_1#00003, TRANSFER, already excluded above). A feed row has no
        // such column, so the descriptor decides — and it has to, because the
        // payer link's feed sweep refuses to re-attribute a transfer-classed
        // row. Offering one here would be an action reporting success while
        // the credit stayed on the list.
        const feed = (o: any) => db.insert(bankTransactions).values({
            accountId: 'acct_1', userId: USER, organizationId: ORG, fy: '2025-26',
            direction: 'CREDIT', reviewStatus: 'PENDING',
            createdAt: D('2026-01-20T00:00:00Z'), updatedAt: D('2026-01-20T00:00:00Z'), ...o,
        });
        await feed({ txnId: 'feed_tfr_1', txnDate: '2026-01-20', description: 'INTERNET TRANSFER FROM SMITH BUILDING', amountCents: 500000 });
        await feed({ txnId: 'feed_tfr_2', txnDate: '2026-01-21', description: 'TFR FROM 062000 123456', amountCents: 250000 });
        await feed({ txnId: 'feed_tfr_3', txnDate: '2026-01-22', description: 'ATO REFUND 4471', amountCents: 180000 });
        await feed({ txnId: 'feed_tfr_4', txnDate: '2026-01-23', description: 'CREDIT CARD PAYMENT THANK YOU', amountCents: 120000 });
        // The control: same account, same shape, a payer descriptor. It reaches
        // the list, so the four above are excluded by their descriptors alone.
        await feed({ txnId: 'feed_payment', txnDate: '2026-01-24', description: 'OSKO PAYMENT FROM HARBOUR CAFE', amountCents: 90000 });

        const page = await repo.listUnmatchedIncome(USER, { olderThan: '2026-03-01' });
        expect(page.items.map((r) => r.txnId)).toEqual(['stmt_1#00055', 'feed_payment', 'stmt_1#00001', 'feed_1']);
        expect(page.totalCount).toBe(4);
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


describe('profile-scoped matching candidates', () => {
    const org = 'matching_scope_org';
    beforeAll(async () => {
        await db.execute(`INSERT INTO orgs (org_id, name) VALUES ('${org}', 'Scoped')`);
        for (const profile of ['A', 'B']) {
            await db.insert(clients).values({ clientId: `scope_client_${profile}`, orgId: org, businessProfileId: profile, createdBy: USER, name: `Client ${profile}` });
        }
        for (const [id, profile, client] of [['own', 'A', 'A'], ['foreign_client', 'A', 'B'], ['other', 'B', 'B'], ['legacy', null, 'A']] as const) {
            await db.insert(invoices).values({ invoiceId: `scope_invoice_${id}`, invoiceNumber: `SCOPE-${id}`, orgId: org, businessProfileId: profile, ownerId: USER, createdBy: USER,
                clientId: `scope_client_${client}`, status: 'SENT', totalAmount: '10', paidAmount: '0' });
        }
        for (const [id, profile] of [['open', 'A'], ['foreign_statement', 'A'], ['foreign_feed', 'A'], ['own_statement', 'A'], ['own_feed', 'A'], ['other', 'B'], ['legacy', null]] as const) {
            await db.insert(receipts).values({ receiptId: `scope_receipt_${id}`, orgId: org, businessProfileId: profile, ownerId: USER, createdBy: USER,
                totalAmount: '10', date: '2026-03-01' });
        }
        for (const profile of ['A', 'B']) {
            await db.insert(statements).values({ statementId: `scope_statement_${profile}`, userId: USER, organizationId: org, businessProfileId: profile, fy: '2025-26', s3Key: `scope_${profile}` });
            await db.insert(statementTransactions).values({ txnId: `scope_statement_${profile}#00001`, statementId: `scope_statement_${profile}`, userId: USER, fy: '2025-26', seq: 1,
                amountCents: -1000, matchedReceiptId: `scope_receipt_${profile === 'A' ? 'own_statement' : 'foreign_statement'}` });
            await db.insert(bankAccounts).values({ accountId: `scope_account_${profile}`, userId: USER, organizationId: org, businessProfileId: profile });
            await db.insert(bankTransactions).values({ txnId: `scope_feed_${profile}`, accountId: `scope_account_${profile}`, userId: USER, organizationId: org, fy: '2025-26',
                amountCents: -1000, matchedReceiptId: `scope_receipt_${profile === 'A' ? 'own_feed' : 'foreign_feed'}` });
        }
    });

    it('excludes other and unassigned invoices, and withholds foreign client details', async () => {
        const result = await repo.listOpenInvoicesForMatching(org, 'A');
        expect(result.map(r => r.invoiceId).sort()).toEqual(['scope_invoice_foreign_client', 'scope_invoice_own']);
        expect(result.find(r => r.invoiceId === 'scope_invoice_own')).toMatchObject({ clientId: 'scope_client_A', clientName: 'Client A' });
        expect(result.find(r => r.invoiceId === 'scope_invoice_foreign_client')).toMatchObject({ clientId: null, clientName: null });
        expect(await repo.listOpenInvoicesForMatching(org, '')).toEqual([]);
    });

    it('uses scoped parents for receipt links so foreign links cannot hide owned candidates', async () => {
        const result = await repo.listUnlinkedReceipts(org, { businessProfileId: 'A', dateFrom: '2026-01-01', dateTo: '2026-12-31' });
        expect(result.map(r => r.receiptId).sort()).toEqual(['scope_receipt_foreign_feed', 'scope_receipt_foreign_statement', 'scope_receipt_open']);
        expect(await repo.listUnlinkedReceipts(org, { businessProfileId: '', dateFrom: '2026-01-01', dateTo: '2026-12-31' })).toEqual([]);
    });
});

describe('immutable matching repository scope', () => {
    const org = 'matching_contract_org';
    let a: LedgerMatchPgRepo;
    let b: LedgerMatchPgRepo;
    beforeAll(async () => {
        await db.execute(`INSERT INTO orgs (org_id, name) VALUES ('${org}', 'Contract'), ('matching_contract_foreign', 'Foreign')`);
        for (const [label, ownerOrg, profile] of [['A', org, 'A'], ['B', org, 'B'], ['legacy', org, null], ['foreign', 'matching_contract_foreign', 'A']] as const) {
            await db.insert(statements).values({ statementId: `contract_${label}`, userId: USER, organizationId: ownerOrg, businessProfileId: profile, fy: '2025-26', s3Key: label });
            await db.insert(bankAccounts).values({ accountId: `contract_${label}`, userId: USER, organizationId: ownerOrg, businessProfileId: profile });
            await db.insert(invoices).values({ invoiceId: `contract_${label}`, invoiceNumber: `CONTRACT-${label}`, orgId: ownerOrg, businessProfileId: profile, ownerId: USER, createdBy: USER, status: 'SENT', totalAmount: '10', paidAmount: '0' });
            await db.insert(receipts).values({ receiptId: `contract_${label}`, orgId: ownerOrg, businessProfileId: profile, ownerId: USER, createdBy: USER, totalAmount: '10', date: '2026-01-01' });
            await db.insert(statementTransactions).values({ txnId: `contract_st_${label}`, statementId: `contract_${label}`, userId: USER, fy: '2025-26', seq: 1, amountCents: 10000,
                direction: 'CREDIT', flowClass: 'INCOME', category: 'INCOME', categorySource: 'AI', txnDate: label === 'A' ? '2026-02-01' : '2026-01-01' });
            await db.insert(bankTransactions).values({ txnId: `contract_bt_${label}`, accountId: `contract_${label}`, userId: USER, organizationId: ownerOrg, fy: '2025-26', amountCents: 10000,
                direction: 'CREDIT', description: 'PAYMENT FROM CUSTOMER', category: 'INCOME', categorySource: 'AI', txnDate: label === 'A' ? '2026-02-02' : '2026-01-01' });
        }
        a = repo.withScope(org, 'A'); b = repo.withScope(org, 'B');
    });

    it('cannot rebind a scoped instance or override candidate scope', async () => {
        expect(() => a.withScope(org, 'B')).toThrow('scope mismatch');
        expect(() => repo.withScope(org, '')).toThrow('scope is required');
        await expect(a.listOpenInvoicesForMatching(org, 'B')).rejects.toThrow('scope mismatch');
        await expect(a.listReceiptChips('matching_contract_foreign', [])).rejects.toThrow('scope mismatch');
        expect((await a.listOpenInvoicesForMatching(org)).map(r => r.invoiceId)).toEqual(['contract_A']);
        expect((await b.listOpenInvoicesForMatching(org)).map(r => r.invoiceId)).toEqual(['contract_B']);
    });

    it.each(['B', 'legacy', 'foreign'])('refuses %s parent rows and mutations even for the same user', async label => {
        expect(await a.listStatementRowsForMatching(USER, `contract_${label}`)).toEqual([]);
        expect(await a.listFeedRowsForMatching(USER, `contract_${label}`, { dateFrom: '2025-01-01' })).toEqual([]);
        for (const [source, prefix] of [['statement', 'st'], ['feed', 'bt']] as const) {
            const id = `contract_${prefix}_${label}`;
            expect(await a.getRowForMatching(USER, source, id)).toBeNull();
            expect(await a.stampMatch(USER, source, id, { type: 'INVOICE', id: 'contract_A' }, 'USER')).toBe('not_found');
            expect(await a.unstampMatch(USER, source, id, { type: 'INVOICE', id: 'contract_A' })).toBe('not_found');
            await a.rejectMatch(USER, id, 'INVOICE', 'contract_A');
            expect((await repo.getRowForMatching(USER, source, id))?.matchedInvoiceId).toBeNull();
            expect(await repo.listRejections(USER, [id])).toEqual([]);
        }
    });

    it.each(['B', 'legacy', 'foreign', 'missing'])('rejects %s receipt/invoice references without a stamp or rejection record', async label => {
        for (const type of ['INVOICE', 'RECEIPT'] as const) {
            for (const [source, id] of [['statement', 'contract_st_A'], ['feed', 'contract_bt_A']] as const) {
                expect(await a.stampMatch(USER, source, id, { type, id: `contract_${label}` }, 'USER')).toBe('conflict');
                await a.rejectMatch(USER, id, type, `contract_${label}`);
                const row = await repo.getRowForMatching(USER, source, id);
                expect(row?.matchedInvoiceId).toBeNull(); expect(row?.matchedReceiptId).toBeNull();
                expect(await repo.listRejections(USER, [id])).toEqual([]);
            }
        }
    });

    it('scope is applied before keyset pagination and total counting', async () => {
        const first = await a.listUnmatchedIncome(USER, { olderThan: '2026-03-01', limit: 1 });
        expect(first.items.map(r => r.txnId)).toEqual(['contract_st_A']); expect(first.totalCount).toBe(2);
        const second = await a.listUnmatchedIncome(USER, { olderThan: '2026-03-01', limit: 1, nextToken: first.nextToken });
        expect(second.items.map(r => r.txnId)).toEqual(['contract_bt_A']); expect(second.totalCount).toBe(2); expect(second.nextToken).toBeNull();
    });

    it('filters chips/deposit evidence and ignores foreign links to owned invoices', async () => {
        const ids = ['contract_A', 'contract_B', 'contract_legacy', 'contract_foreign'];
        expect((await a.listInvoiceChips(org, ids)).map(r => r.invoiceId)).toEqual(['contract_A']);
        expect((await a.listReceiptChips(org, ids)).map(r => r.receiptId)).toEqual(['contract_A']);
        await repo.stampMatch(USER, 'statement', 'contract_st_B', { type: 'INVOICE', id: 'contract_A' }, 'USER');
        expect(await a.depositCheckForInvoices(org, ids)).toEqual([{ invoiceId: 'contract_A', bankMatched: false, lastBankTransferPaymentDate: null }]);
    });

    it('quarantines legacy foreign links instead of returning their identifiers', async () => {
        // This invalid old link was inserted through the legacy unscoped adapter above.
        expect(await b.getRowForMatching(USER, 'statement', 'contract_st_B')).toBeNull();
        expect(await b.listStatementRowsForMatching(USER, 'contract_B')).toEqual([]);
    });

    it('checks ownership again in the mutation after a previously owned read', async () => {
        const row = await a.getRowForMatching(USER, 'statement', 'contract_st_A');
        expect(row).not.toBeNull();
        await db.execute(`UPDATE statements SET business_profile_id = 'B' WHERE statement_id = 'contract_A'`);
        expect(await a.stampMatch(USER, 'statement', 'contract_st_A', { type: 'INVOICE', id: 'contract_A' }, 'USER')).toBe('not_found');
        await a.rejectMatch(USER, 'contract_st_A', 'INVOICE', 'contract_A');
        expect(await repo.listRejections(USER, ['contract_st_A'])).toEqual([]);
        expect((await repo.getRowForMatching(USER, 'statement', 'contract_st_A'))?.matchedInvoiceId).toBeNull();
        await db.execute(`UPDATE statements SET business_profile_id = 'A' WHERE statement_id = 'contract_A'`);
        await db.execute(`UPDATE invoices SET business_profile_id = 'B' WHERE invoice_id = 'contract_A'`);
        expect(await a.stampMatch(USER, 'statement', 'contract_st_A', { type: 'INVOICE', id: 'contract_A' }, 'USER')).toBe('conflict');
        expect((await repo.getRowForMatching(USER, 'statement', 'contract_st_A'))?.matchedInvoiceId).toBeNull();
        await db.execute(`UPDATE invoices SET business_profile_id = 'A' WHERE invoice_id = 'contract_A'`);
    });

    it('same-profile stamp, reject and reverse remain usable for statement and feed rows', async () => {
        for (const [source, id] of [['statement', 'contract_st_A'], ['feed', 'contract_bt_A']] as const) {
            expect(await a.stampMatch(USER, source, id, { type: 'INVOICE', id: 'contract_A' }, 'USER')).toBe('linked');
            expect(await a.stampMatch(USER, source, id, { type: 'INVOICE', id: 'contract_A' }, 'USER')).toBe('linked');
            expect(await a.unstampMatch(USER, source, id, { type: 'INVOICE', id: 'contract_A' })).toBe('cleared');
            await a.rejectMatch(USER, id, 'INVOICE', 'contract_A');
            expect(await a.listRejections(USER, [id])).toEqual([{ txnId: id, targetType: 'INVOICE', targetId: 'contract_A' }]);
            expect(await b.listRejections(USER, [id])).toEqual([]);
        }
    });
});
