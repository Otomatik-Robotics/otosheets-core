import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from './migrate';
import type { PgDb } from './client';
import { ClientPgRepo } from '../client/repo.pg';
import { InvoicePgRepo } from '../invoice/repo.pg';
import { InvoicePaymentPgRepo } from '../invoicePayment/repo.pg';

let db: PgDb;

beforeAll(async () => {
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    // Seed the org (FK target) — billing tables cascade from orgs.
    await pglite.query("INSERT INTO orgs (org_id, name) VALUES ('org_1', 'Acme')");
});

describe('ClientPgRepo', () => {
    const repo = () => new ClientPgRepo(db);

    it('CRUD with contacts child table + DTO parity', async () => {
        await repo().createClient('org_1', 'c_1', { createdBy: 'user_1',
            name: 'Bob Co', isCompany: true, email: 'bob@co.com',
            contacts: [{ firstName: 'Bob', email: 'bob@co.com', isPrimary: true }, { firstName: 'Sue' }],
        });
        const c = await repo().getClient('org_1', 'c_1');
        expect(c).toMatchObject({ clientId: 'c_1', name: 'Bob Co', isCompany: true });
        expect(c!.contacts).toEqual([{ firstName: 'Bob', email: 'bob@co.com', isPrimary: true }, { firstName: 'Sue' }]);
        expect(typeof c!.createdAt).toBe('string');

        await repo().updateClient('org_1', 'c_1', { name: 'Bob Corp', contacts: [{ firstName: 'Only' }] });
        const u = await repo().getClient('org_1', 'c_1');
        expect(u!.name).toBe('Bob Corp');
        expect(u!.contacts).toEqual([{ firstName: 'Only' }]);
    });

    it('trigram search, count, top-by-usage, increment', async () => {
        await repo().createClient('org_1', 'c_2', { createdBy: 'user_1', name: 'Zebra Ltd', abn: '999' });
        expect(await repo().countClients('org_1')).toBe(2);
        const found = await repo().listClientsPaginated({ orgId: 'org_1', search: 'zebra' });
        expect(found.items.map(c => c.clientId)).toEqual(['c_2']);

        await repo().incrementPaymentLinkUsage('org_1', 'c_2');
        await repo().incrementPaymentLinkUsage('org_1', 'c_2');
        const top = await repo().getTopByUsage('org_1', 1);
        expect(top[0].clientId).toBe('c_2');
    });

    it('keyset pagination is stable across pages', async () => {
        const r = new ClientPgRepo(db);
        for (let i = 0; i < 5; i++) await r.createClient('org_1', `pg_${i}`, { createdBy: 'user_1', name: `Client ${i}` });
        const page1 = await r.listClientsPaginated({ orgId: 'org_1', limit: 3 });
        expect(page1.items).toHaveLength(3);
        expect(page1.lastEvaluatedKey).toBeDefined();
        const page2 = await r.listClientsPaginated({ orgId: 'org_1', limit: 3, exclusiveStartKey: page1.lastEvaluatedKey });
        const ids1 = page1.items.map(c => c.clientId);
        const ids2 = page2.items.map(c => c.clientId);
        expect(ids1.filter(id => ids2.includes(id))).toHaveLength(0); // no overlap
    });
});

describe('InvoicePgRepo', () => {
    const inv = () => new InvoicePgRepo(db, db);

    it('create + get reconstructs sk / dueDateSk / items / clientSnapshot', async () => {
        await inv().createInvoice('org_1', 'user_1', 'inv_1', {
            invoiceNumber: 'INV-001', date: '2026-07-01', dueDate: '2026-07-15', status: 'DRAFT',
            subtotal: 100, gstAmount: 10, totalAmount: 110, clientSnapshot: { name: 'Snap' },
            items: [{ id: 'li_1', description: 'Work', quantity: 2, unitPrice: 50, total: 100, sortOrder: 0 }],
        });
        const i = await inv().getInvoice('org_1', 'user_1', 'inv_1');
        expect(i).toMatchObject({ invoiceId: 'inv_1', invoiceNumber: 'INV-001', status: 'DRAFT', subtotal: 100, totalAmount: 110 });
        expect(i!.sk).toBe('user_1#inv_1');                    // reconstructed
        expect((i as any).dueDateSk).toBe('2026-07-15#inv_1'); // reconstructed
        expect(i!.clientSnapshot).toEqual({ name: 'Snap' });   // from legacy_client_snapshot
        expect(i!.items).toEqual([{ id: 'li_1', description: 'Work', quantity: 2, unitPrice: 50, total: 100, sortOrder: 0 }]);
        expect((i as any).ownerId).toBeUndefined();            // pg-only, not exposed
    });

    it('update replaces line items and never upserts', async () => {
        await inv().updateInvoice('org_1', 'user_1', 'inv_1', { status: 'SENT', items: [{ id: 'li_x', description: 'New', quantity: 1, unitPrice: 5, total: 5, sortOrder: 0 }] });
        const i = await inv().getInvoice('org_1', 'user_1', 'inv_1');
        expect(i!.status).toBe('SENT');
        expect(i!.items).toHaveLength(1);
        expect(i!.items[0].id).toBe('li_x');
        await expect(inv().updateInvoice('org_1', 'user_1', 'missing', { status: 'X' })).rejects.toThrow(/must not upsert/);
    });

    it('overdue query filters by status + due date', async () => {
        await inv().createInvoice('org_1', 'user_1', 'inv_od', { invoiceNumber: 'INV-OD', dueDate: '2026-01-01', status: 'SENT' });
        const overdue = await inv().listOverdueInvoices('org_1', '2026-06-01');
        expect(overdue.map(i => i.invoiceId)).toContain('inv_od');
    });

    it('paginated list excludes payment links by default', async () => {
        await inv().createInvoice('org_1', 'user_1', 'inv_pl', { invoiceNumber: 'PL', isPaymentLink: true });
        const page = await inv().listOrgInvoicesPaginated({ orgId: 'org_1', limit: 50 });
        expect(page.items.map(i => i.invoiceId)).not.toContain('inv_pl');
    });

    it('upsertInvoice accepts a Dynamo-shaped DTO with ISO-string timestamps (mirror/backfill path)', async () => {
        // Regression: custom row mapper must convert string createdAt/updatedAt to Date.
        await inv().upsertInvoice({
            invoiceId: 'inv_mirror', orgId: 'org_1', sk: 'user_1#inv_mirror', createdBy: 'user_1',
            invoiceNumber: 'MIR-1', status: 'SENT', totalAmount: 42,
            createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-02T00:00:00.000Z',
            items: [{ id: 'm1', description: 'x', quantity: 1, unitPrice: 42, total: 42, sortOrder: 0 }],
        } as any);
        const i = await inv().getInvoice('org_1', 'user_1', 'inv_mirror');
        expect(i!.totalAmount).toBe(42);
        expect(i!.createdAt).toBe('2026-07-01T00:00:00.000Z');
    });
});

describe('InvoicePaymentPgRepo', () => {
    const pay = () => new InvoicePaymentPgRepo(db, db);
    const invoiceRepo = () => new InvoicePgRepo(db, db);

    it('recordPayment is atomic + idempotent, rolls invoice paidAmount/status', async () => {
        await invoiceRepo().createInvoice('org_1', 'user_1', 'inv_pay', { invoiceNumber: 'PAY-1', totalAmount: 100, paidAmount: 0, status: 'SENT' });
        await pay().recordPayment('org_1', 'inv_pay', 'user_1', 'p_1', { amount: 60, method: 'CASH', date: '2026-07-02' }, 60, 'PARTIAL');

        const payments = await pay().listPayments('org_1', 'inv_pay');
        expect(payments).toHaveLength(1);
        expect(payments[0]).toMatchObject({ paymentId: 'p_1', amount: 60, method: 'CASH' });
        expect(payments[0].sk).toBe('inv_pay#p_1'); // reconstructed
        let i = await invoiceRepo().getInvoice('org_1', 'user_1', 'inv_pay');
        expect(i!.paidAmount).toBe(60);
        expect(i!.status).toBe('PARTIAL');

        // Replay same paymentId — no double count, invoice untouched
        await pay().recordPayment('org_1', 'inv_pay', 'user_1', 'p_1', { amount: 60, method: 'CASH', date: '2026-07-02' }, 999, 'PAID');
        expect(await pay().listPayments('org_1', 'inv_pay')).toHaveLength(1);
        i = await invoiceRepo().getInvoice('org_1', 'user_1', 'inv_pay');
        expect(i!.paidAmount).toBe(60); // not clobbered by the replay
    });
});

describe('InvoicePgRepo.getInvoiceSummary', () => {
    // Fresh org so the KPI figures are deterministic (org_1 is dirtied by tests above).
    const ORG = 'org_sum';
    const inv = () => new InvoicePgRepo(db, db);
    const past = '2020-01-01';   // safely before "today"
    const future = '2999-01-01'; // safely after "today"

    beforeAll(async () => {
        await (db as any).execute(sql`INSERT INTO orgs (org_id, name) VALUES (${ORG}, 'Sum Co')`);
        const mk = (id: string, data: Record<string, any>) =>
            inv().createInvoice(ORG, 'user_1', id, { invoiceNumber: id, ...data });
        await mk('s_await', { status: 'SENT', dueDate: future, totalAmount: 18922, paidAmount: 0 });
        await mk('s_overdue', { status: 'OVERDUE', dueDate: past, totalAmount: 13988, paidAmount: 0 });
        await mk('s_sent_pastdue', { status: 'SENT', dueDate: past, totalAmount: 1000, paidAmount: 0 });
        await mk('s_partial', { status: 'PARTIAL', dueDate: future, totalAmount: 1000, paidAmount: 400 });
        await mk('s_draft', { status: 'DRAFT', dueDate: future, totalAmount: 8370, paidAmount: 0 });
        await mk('s_paid', { status: 'PAID', dueDate: past, totalAmount: 5000, paidAmount: 5000 });
        await mk('s_link', { status: 'SENT', dueDate: past, totalAmount: 999, paidAmount: 0, isPaymentLink: true });
        await mk('s_quote', { status: 'SENT', dueDate: past, totalAmount: 500, paidAmount: 0, isQuote: true });
    });

    it('aggregates outstanding / overdue / awaiting / draft, deriving past-due and excluding quotes+links+paid', async () => {
        const s = await inv().getInvoiceSummary(ORG);
        // draft: face value of the single draft
        expect(s.draft).toEqual({ amount: 8370, count: 1 });
        // overdue: stored OVERDUE (13988) + SENT-but-past-due (1000), derived
        expect(s.overdue).toEqual({ amount: 14988, count: 2 });
        // awaiting: future SENT (18922) + future PARTIAL remainder (600)
        expect(s.awaiting).toEqual({ amount: 19522, count: 2 });
        // outstanding is the sum of the two open buckets
        expect(s.outstanding).toEqual({ amount: 34510, count: 4 });
    });
});
