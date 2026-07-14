import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from './migrate';
import type { PgDb } from './client';
import {
    BankAccountPgRepo, matchStatementAccount, statementAccountId, last4Digits,
} from '../bankAccount/repo.pg';
import type { BankAccount } from '../bankAccount/schema';
import { BankTransactionPgRepo } from '../bankTransaction/repo.pg';

let db: PgDb;
let pglite: PGlite;

const USER = 'user_bank_1';
const ACCT = 'fiskil_acct_0001';

function account(overrides: Record<string, any> = {}) {
    return {
        accountId: ACCT,
        userId: USER,
        provider: 'fiskil',
        consentId: 'consent_1',
        institutionId: 'inst_cba',
        institutionName: 'Commonwealth Bank',
        name: 'Business Everyday',
        productCategory: 'BUSINESS_TRANSACTION_AND_SAVINGS_ACCOUNTS',
        accountNumberMasked: 'xxxx1234',
        bsb: '062-000',
        openStatus: 'OPEN',
        status: 'ACTIVE',
        ...overrides,
    };
}

function txn(id: string, overrides: Record<string, any> = {}) {
    return {
        txnId: id,
        accountId: ACCT,
        userId: USER,
        fy: '2025-26',
        txnDate: '2025-08-14',
        description: 'BUNNINGS 000123',
        amountCents: -4599,
        direction: 'DEBIT',
        status: 'POSTED',
        merchantName: 'Bunnings',
        providerCategory: 'HARDWARE',
        reviewStatus: 'PENDING',
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
    expect(ran).toContain('0012_bank_feeds.sql');
    expect(await runMigrations(executor)).toEqual([]); // idempotent
    db = drizzle(pglite) as unknown as PgDb;
});

describe('BankAccountPgRepo', () => {
    const repo = () => new BankAccountPgRepo(db);

    it('upserts idempotently and reads back a DTO', async () => {
        await repo().upsertAccount(account());
        await repo().upsertAccount(account({ name: 'Business Everyday (renamed)' })); // re-sync
        const acct = await repo().getAccount(USER, ACCT);
        expect(acct).toMatchObject({ accountId: ACCT, status: 'ACTIVE', name: 'Business Everyday (renamed)' });
        expect(await repo().listAccounts(USER)).toHaveLength(1);
    });

    it('disconnects every account under a consent (idempotent)', async () => {
        const n = await repo().disconnectByConsent(USER, 'consent_1');
        expect(n).toBe(1);
        const acct = await repo().getAccount(USER, ACCT);
        expect(acct!.status).toBe('DISCONNECTED');
        await repo().upsertAccount(account()); // reconnect for later tests
    });
});

describe('statement-account unification', () => {
    const repo = () => new BankAccountPgRepo(db);

    it('last4Digits normalises masked/formatted numbers', () => {
        expect(last4Digits('xxxx1234')).toBe('1234');
        expect(last4Digits('062-000 12345678')).toBe('5678');
        expect(last4Digits('123')).toBeNull();
        expect(last4Digits(null)).toBeNull();
    });

    it('matchStatementAccount: last-4 + institution containment, feed account preferred', () => {
        const feed = { accountId: 'f1', provider: 'fiskil', institutionName: 'Commonwealth Bank', accountNumberMasked: 'xxxx1234', status: 'ACTIVE' } as BankAccount;
        const stmt = { accountId: 's1', provider: 'statement', institutionName: 'Commonwealth Bank', accountNumberMasked: '1234', status: 'ACTIVE' } as BankAccount;
        const other = { accountId: 'f2', provider: 'fiskil', institutionName: 'Westpac', accountNumberMasked: 'xxxx1234', status: 'ACTIVE' } as BankAccount;
        const gone = { accountId: 'f3', provider: 'fiskil', institutionName: 'Commonwealth Bank', accountNumberMasked: 'xxxx1234', status: 'DISCONNECTED' } as BankAccount;

        // Feed account wins over the statement-derived twin.
        expect(matchStatementAccount([stmt, feed], { bankName: 'Commonwealth Bank', accountLast4: '1234' })?.accountId).toBe('f1');
        // Same last-4 at a different institution never matches.
        expect(matchStatementAccount([other], { bankName: 'Commonwealth Bank', accountLast4: '1234' })).toBeNull();
        // Disconnected accounts are ignored; no last-4 → no keying.
        expect(matchStatementAccount([gone], { bankName: 'Commonwealth Bank', accountLast4: '1234' })).toBeNull();
        expect(matchStatementAccount([feed], { bankName: 'Commonwealth Bank', accountLast4: null })).toBeNull();
        // Unknown bank on the statement side still matches on last-4 alone.
        expect(matchStatementAccount([feed], { bankName: null, accountLast4: '1234' })?.accountId).toBe('f1');
    });

    it('findOrCreateStatementAccount reuses the feed account when it matches', async () => {
        const acct = await repo().findOrCreateStatementAccount({
            userId: USER, bankName: 'CommBank', accountLast4: '1234',
        });
        // 'commbank' ⊄ 'commonwealthbank' — different normalised names, so a NEW
        // statement account is created rather than silently merging.
        expect(acct?.provider).toBe('statement');

        const exact = await repo().findOrCreateStatementAccount({
            userId: USER, bankName: 'Commonwealth Bank', accountLast4: '1234',
        });
        expect(exact?.accountId).toBe(ACCT); // reused the fiskil account
    });

    it('creates a deterministic statement account and is idempotent', async () => {
        const input = { userId: USER, bankName: 'Westpac', accountLast4: '9876', organizationId: 'org_1' };
        const first = await repo().findOrCreateStatementAccount(input);
        const second = await repo().findOrCreateStatementAccount(input);
        expect(first?.accountId).toBe(statementAccountId(USER, { bankName: 'Westpac', accountLast4: '9876' }));
        expect(second?.accountId).toBe(first?.accountId);
        expect(first).toMatchObject({
            provider: 'statement', institutionName: 'Westpac',
            accountNumberMasked: '9876', organizationId: 'org_1', status: 'ACTIVE',
        });
        // Identity too weak to key on → null, nothing created.
        expect(await repo().findOrCreateStatementAccount({ userId: USER, bankName: 'ANZ', accountLast4: null })).toBeNull();
    });
});

describe('BankTransactionPgRepo', () => {
    const repo = () => new BankTransactionPgRepo(db);

    it('upserts feed transactions idempotently', async () => {
        await repo().upsertTransactions([txn('t1'), txn('t2', { txnDate: '2025-08-15', amountCents: 250000, direction: 'CREDIT' })]);
        await repo().upsertTransactions([txn('t1'), txn('t2', { txnDate: '2025-08-15', amountCents: 250000, direction: 'CREDIT' })]);
        const page = await repo().listByAccount(USER, ACCT, { limit: 10 });
        expect(page.items).toHaveLength(2);
        expect(page.items[0].txnDate).toBe('2025-08-15'); // newest date first
    });

    it('a re-sync does NOT clobber a user categorisation (annotation layer protected)', async () => {
        await repo().updateCategory(USER, 't1', {
            category: 'Materials', categorySource: 'USER', gstTreatment: 'GST', gstAmountCents: -418,
        });
        // provider sends the same txn again with an updated description
        await repo().upsertTransactions([txn('t1', { description: 'BUNNINGS WAREHOUSE 000123' })]);
        const t1 = await repo().getTransaction(USER, 't1');
        expect(t1!.description).toBe('BUNNINGS WAREHOUSE 000123'); // extraction layer refreshed
        expect(t1!.category).toBe('Materials');                    // annotation layer preserved
        expect(t1!.categorySource).toBe('USER');
        expect(t1!.reviewStatus).toBe('CONFIRMED');
    });

    it('summarises signed cents into money-in / money-out per category', async () => {
        const rows = await repo().summariseByCategory({ userId: USER, fy: '2025-26' });
        const materials = rows.find((r) => r.category === 'Materials');
        const uncat = rows.find((r) => r.category === 'UNCATEGORIZED');
        expect(materials?.outCents).toBe(4599);
        expect(uncat?.inCents).toBe(250000); // the uncategorised CREDIT
    });

    it('paginates by keyset', async () => {
        const rows = Array.from({ length: 5 }, (_, i) =>
            txn(`p${i}`, { txnDate: `2025-09-0${i + 1}`, amountCents: -100 * (i + 1) }));
        await repo().upsertTransactions(rows);
        const first = await repo().listByFy(USER, '2025-26', { limit: 3 });
        expect(first.items).toHaveLength(3);
        expect(first.nextToken).toBeTruthy();
        const second = await repo().listByFy(USER, '2025-26', { limit: 3, nextToken: first.nextToken });
        const ids = new Set([...first.items, ...second.items].map((t) => t.txnId));
        expect(ids.size).toBe(first.items.length + second.items.length); // no overlap
    });
});
