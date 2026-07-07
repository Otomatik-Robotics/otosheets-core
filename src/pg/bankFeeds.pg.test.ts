import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from './migrate';
import type { PgDb } from './client';
import { BankAccountPgRepo } from '../bankAccount/repo.pg';
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
