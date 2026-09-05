import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { clients, invoices, invoicePayments } from '../pg/schema/billingCore';
import { BasReportingPgRepo } from '../basReporting/inputs.pg';
import { IncomeReportingPgRepo, daysBetween, incomeMonths } from './income.pg';

let db: PgDb;
let repo: IncomeReportingPgRepo;
let bas: BasReportingPgRepo;

const D = (s: string) => new Date(s);
const ORG = 'org_1';
const USER = 'u_1';
const TODAY = '2026-09-05';
const SCOPE = { orgId: ORG, dateFrom: '2026-07-01', dateTo: '2026-09-30', today: TODAY };

beforeAll(async () => {
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    repo = new IncomeReportingPgRepo(db);
    bas = new BasReportingPgRepo(db);

    await pglite.query(`INSERT INTO orgs (org_id, name) VALUES ('${ORG}', 'Acme'), ('org_b', 'Empty Co')`);

    const client = (id: string, name: string) => db.insert(clients).values({
        clientId: id, orgId: ORG, createdBy: USER, name,
        createdAt: D('2026-06-01T00:00:00Z'), updatedAt: D('2026-06-01T00:00:00Z'),
    });
    await client('c_rose', 'Rosewood Property');
    await client('c_sam', 'Sam Reilly');
    await client('c_lawn', 'Lawn and Law');
    await client('c_jerry', 'Jerry Jovial');

    const inv = (o: Record<string, any>) => db.insert(invoices).values({
        orgId: ORG, ownerId: USER, createdBy: USER,
        createdAt: D('2026-07-01T00:00:00Z'), updatedAt: D('2026-07-01T00:00:00Z'), ...o,
    });

    // ── Counted: real invoices issued inside the window ──
    // Settled in full, paid 7 days after issue.
    await inv({
        invoiceId: 'i_paid', invoiceNumber: 'INV-1042', clientId: 'c_jerry', status: 'PAID',
        date: '2026-07-02', dueDate: '2026-07-16', subtotal: '1000', gstAmount: '100',
        totalAmount: '1100', paidAmount: '1100',
    });
    await db.insert(invoicePayments).values({
        paymentId: 'p_1', invoiceId: 'i_paid', orgId: ORG, userId: USER, amount: '1100',
        method: 'BANK', date: '2026-07-09', createdAt: D('2026-07-09T00:00:00Z'),
    });
    // Settled in full over two payments; the LAST one is the paid date (21 days).
    await inv({
        invoiceId: 'i_paid_two', invoiceNumber: 'INV-1051', clientId: 'c_rose', status: 'PAID',
        date: '2026-07-14', dueDate: '2026-07-28', subtotal: '2000', gstAmount: '200',
        totalAmount: '2200', paidAmount: '2200',
    });
    await db.insert(invoicePayments).values([
        { paymentId: 'p_2a', invoiceId: 'i_paid_two', orgId: ORG, userId: USER, amount: '1000', method: 'BANK', date: '2026-07-20', createdAt: D('2026-07-20T00:00:00Z') },
        { paymentId: 'p_2b', invoiceId: 'i_paid_two', orgId: ORG, userId: USER, amount: '1200', method: 'BANK', date: '2026-08-04', createdAt: D('2026-08-04T00:00:00Z') },
    ]);
    // Part paid, and past its due date: PART_PAID wins over OVERDUE.
    await inv({
        invoiceId: 'i_part', invoiceNumber: 'INV-1058', clientId: 'c_jerry', status: 'PARTIAL',
        date: '2026-07-28', dueDate: '2026-08-11', subtotal: '2000', gstAmount: '200',
        totalAmount: '2200', paidAmount: '1300',
    });
    await db.insert(invoicePayments).values({
        paymentId: 'p_3', invoiceId: 'i_part', orgId: ORG, userId: USER, amount: '1300',
        method: 'BANK', date: '2026-08-19', createdAt: D('2026-08-19T00:00:00Z'),
    });
    // Nothing paid, due date passed: OVERDUE.
    await inv({
        invoiceId: 'i_overdue', invoiceNumber: 'INV-1048', clientId: 'c_sam', status: 'SENT',
        date: '2026-07-09', dueDate: '2026-08-18', subtotal: '3000', gstAmount: '300',
        totalAmount: '3300', paidAmount: '0',
    });
    // Nothing paid, due date ahead: SENT.
    await inv({
        invoiceId: 'i_sent', invoiceNumber: 'INV-1071', clientId: 'c_lawn', status: 'SENT',
        date: '2026-08-16', dueDate: '2026-09-30', subtotal: '4000', gstAmount: '400',
        totalAmount: '4400', paidAmount: '0',
    });
    // No client at all — one null bucket, not one bucket per invoice.
    await inv({
        invoiceId: 'i_noclient', invoiceNumber: 'INV-1090', status: 'SENT',
        date: '2026-09-01', dueDate: '2026-09-29', subtotal: '500', gstAmount: '50',
        totalAmount: '550', paidAmount: '0',
    });

    // ── Excluded, exactly as the BAS excludes them ──
    await inv({ invoiceId: 'x_draft', invoiceNumber: 'D-1', status: 'DRAFT', date: '2026-07-11', subtotal: '9000', gstAmount: '900', totalAmount: '9900' });
    await inv({ invoiceId: 'x_void', invoiceNumber: 'V-1', status: 'VOID', date: '2026-07-12', subtotal: '9000', gstAmount: '900', totalAmount: '9900' });
    await inv({ invoiceId: 'x_quote', invoiceNumber: 'Q-1', status: 'SENT', isQuote: true, date: '2026-07-20', subtotal: '9000', gstAmount: '900', totalAmount: '9900' });
    await inv({ invoiceId: 'x_recur', invoiceNumber: 'R-1', status: 'SENT', isRecurring: true, date: '2026-07-20', subtotal: '9000', gstAmount: '900', totalAmount: '9900' });
    await inv({ invoiceId: 'x_link', invoiceNumber: 'PL-1', status: 'PAID', isPaymentLink: true, date: '2026-07-20', subtotal: '9000', gstAmount: '900', totalAmount: '9900' });
    // Outside the window on both sides.
    await inv({ invoiceId: 'x_before', invoiceNumber: 'INV-0900', status: 'SENT', date: '2026-06-30', subtotal: '9000', gstAmount: '900', totalAmount: '9900' });
    await inv({ invoiceId: 'x_after', invoiceNumber: 'INV-1200', status: 'SENT', date: '2026-10-01', subtotal: '9000', gstAmount: '900', totalAmount: '9900' });
});

describe('helpers', () => {
    it('counts whole days between two dates', () => {
        expect(daysBetween('2026-07-02', '2026-07-09')).toBe(7);
        expect(daysBetween('2026-07-09', '2026-07-02')).toBe(-7);
        expect(daysBetween('2026-07-02', '2026-07-02')).toBe(0);
    });

    it('lists every calendar month overlapping a window, year boundary included', () => {
        expect(incomeMonths('2026-07-01', '2026-09-30')).toEqual(['2026-07', '2026-08', '2026-09']);
        expect(incomeMonths('2026-12-15', '2027-02-02')).toEqual(['2026-12', '2027-01', '2027-02']);
    });
});

describe('listIssued', () => {
    it('returns every invoice issued in the window, newest first, drafts and voids excluded', async () => {
        const { items, nextCursor } = await repo.listIssued({ ...SCOPE, limit: 50 });
        expect(items.map((i) => i.invoiceId)).toEqual([
            'i_noclient', 'i_sent', 'i_part', 'i_paid_two', 'i_overdue', 'i_paid',
        ]);
        expect(nextCursor).toBeNull();
    });

    it('derives the status: PAID, then PART_PAID, then OVERDUE, else SENT', async () => {
        const { items } = await repo.listIssued({ ...SCOPE, limit: 50 });
        const byId = new Map(items.map((i) => [i.invoiceId, i]));
        expect(byId.get('i_paid')!.status).toBe('PAID');
        expect(byId.get('i_paid_two')!.status).toBe('PAID');
        // Part paid AND past due: part paid wins.
        expect(byId.get('i_part')!.status).toBe('PART_PAID');
        expect(byId.get('i_overdue')!.status).toBe('OVERDUE');
        expect(byId.get('i_sent')!.status).toBe('SENT');
    });

    it('dates the payment from the LAST payment and measures days to pay from issue', async () => {
        const { items } = await repo.listIssued({ ...SCOPE, limit: 50 });
        const byId = new Map(items.map((i) => [i.invoiceId, i]));
        expect(byId.get('i_paid')!.paidDate).toBe('2026-07-09');
        expect(byId.get('i_paid')!.daysToPay).toBe(7);
        expect(byId.get('i_paid_two')!.paidDate).toBe('2026-08-04');
        expect(byId.get('i_paid_two')!.daysToPay).toBe(21);
        expect(byId.get('i_sent')!.paidDate).toBeNull();
        expect(byId.get('i_sent')!.daysToPay).toBeNull();
    });

    it('reports days past due only on the overdue rows', async () => {
        const { items } = await repo.listIssued({ ...SCOPE, limit: 50 });
        const byId = new Map(items.map((i) => [i.invoiceId, i]));
        expect(byId.get('i_overdue')!.daysPastDue).toBe(18);
        expect(byId.get('i_sent')!.daysPastDue).toBeNull();
        expect(byId.get('i_part')!.daysPastDue).toBeNull();
    });

    it('joins the client name live, and tolerates an invoice with no client', async () => {
        const { items } = await repo.listIssued({ ...SCOPE, limit: 50 });
        const byId = new Map(items.map((i) => [i.invoiceId, i]));
        expect(byId.get('i_overdue')!.clientName).toBe('Sam Reilly');
        expect(byId.get('i_noclient')!.clientId).toBeNull();
        expect(byId.get('i_noclient')!.clientName).toBeNull();
    });

    it('pages with a keyset cursor and never repeats a row', async () => {
        const first = await repo.listIssued({ ...SCOPE, limit: 2 });
        expect(first.items).toHaveLength(2);
        expect(first.nextCursor).not.toBeNull();
        const second = await repo.listIssued({ ...SCOPE, limit: 2, cursor: first.nextCursor });
        expect(second.items).toHaveLength(2);
        const ids = [...first.items, ...second.items].map((i) => i.invoiceId);
        expect(new Set(ids).size).toBe(4);
        expect(ids).toEqual(['i_noclient', 'i_sent', 'i_part', 'i_paid_two']);
    });

    it('filters by derived status in the query', async () => {
        const overdue = await repo.listIssued({ ...SCOPE, limit: 50, status: 'OVERDUE' });
        expect(overdue.items.map((i) => i.invoiceId)).toEqual(['i_overdue']);
        const paid = await repo.listIssued({ ...SCOPE, limit: 50, status: 'PAID' });
        expect(paid.items.map((i) => i.invoiceId)).toEqual(['i_paid_two', 'i_paid']);
    });

    it('searches invoice number or client name in the query', async () => {
        const byNumber = await repo.listIssued({ ...SCOPE, limit: 50, search: '1048' });
        expect(byNumber.items.map((i) => i.invoiceId)).toEqual(['i_overdue']);
        const byClient = await repo.listIssued({ ...SCOPE, limit: 50, search: 'rosewood' });
        expect(byClient.items.map((i) => i.invoiceId)).toEqual(['i_paid_two']);
    });

    it('answers nothing for an org with no invoices', async () => {
        const { items, nextCursor } = await repo.listIssued({ ...SCOPE, orgId: 'org_b', limit: 50 });
        expect(items).toEqual([]);
        expect(nextCursor).toBeNull();
    });
});

describe('totals', () => {
    it('carries the projection and the actual over the whole window', async () => {
        const t = await repo.totals(SCOPE);
        // 1100 + 2200 + 2200 + 3300 + 4400 + 550
        expect(t.invoiced).toBe(13750);
        expect(t.invoiceCount).toBe(6);
        // 1100 + 2200 + 1300
        expect(t.received).toBe(4600);
        expect(t.paidCount).toBe(2);
        expect(t.stillOwed).toBe(9150);
        expect(t.owedCount).toBe(4);
        // Past due and not settled: i_part and i_overdue. i_part reads PART_PAID
        // as a row, and is still money that is late.
        expect(t.overdueCount).toBe(2);
    });

    it('ties gstOnIssued to the BAS 1A for the same window', async () => {
        const t = await repo.totals(SCOPE);
        const inputs = await bas.inputs({ orgId: ORG, dateFrom: SCOPE.dateFrom, dateTo: SCOPE.dateTo });
        expect(t.gstOnIssued).toBe(inputs.invoices.gstCollected);
        expect(t.invoiceCount).toBe(inputs.invoices.count);
    });

    it('averages days to pay over the invoices settled in full', async () => {
        const t = await repo.totals(SCOPE);
        // 7 and 21 — the part paid invoice does not count.
        expect(t.averageDaysToPay).toBe(14);
    });

    it('reports no average when nothing has been paid', async () => {
        const t = await repo.totals({ ...SCOPE, orgId: 'org_b' });
        expect(t.averageDaysToPay).toBeNull();
        expect(t.invoiced).toBe(0);
        expect(t.invoiceCount).toBe(0);
    });
});

describe('byMonth', () => {
    it('rolls up by the month of issue and fills the quiet months', async () => {
        const rows = await repo.byMonth(SCOPE);
        expect(rows.map((r) => r.month)).toEqual(['2026-07', '2026-08', '2026-09']);
        // Jul: i_paid 1100 + i_paid_two 2200 + i_part 2200 + i_overdue 3300
        expect(rows[0]).toEqual({ month: '2026-07', invoiced: 8800, received: 4600 });
        expect(rows[1]).toEqual({ month: '2026-08', invoiced: 4400, received: 0 });
        expect(rows[2]).toEqual({ month: '2026-09', invoiced: 550, received: 0 });
    });

    it('returns a zero row per month for an org with no invoices', async () => {
        const rows = await repo.byMonth({ ...SCOPE, orgId: 'org_b' });
        expect(rows).toEqual([
            { month: '2026-07', invoiced: 0, received: 0 },
            { month: '2026-08', invoiced: 0, received: 0 },
            { month: '2026-09', invoiced: 0, received: 0 },
        ]);
    });
});

describe('owedBy', () => {
    it('ranks the top clients and folds the rest into one remainder', async () => {
        const { top, other } = await repo.owedBy(SCOPE, 3);
        expect(top.map((r) => [r.clientName, r.amount])).toEqual([
            ['Lawn and Law', 4400],
            ['Sam Reilly', 3300],
            ['Jerry Jovial', 900],
        ]);
        expect(top[1].overdue).toBe(1);
        expect(top[0].overdue).toBe(0);
        expect(top.every((r) => r.invoices === 1)).toBe(true);
        // The no-client invoice is the only thing past the top three.
        expect(other).toEqual({ clients: 1, amount: 550 });
    });

    it('leaves no remainder when every client fits in the top', async () => {
        const { top, other } = await repo.owedBy(SCOPE, 10);
        expect(top).toHaveLength(4);
        expect(other).toEqual({ clients: 0, amount: 0 });
        // Everything still owed, top and remainder together.
        const summed = top.reduce((sum, r) => sum + r.amount, 0) + other.amount;
        expect(summed).toBe((await repo.totals(SCOPE)).stillOwed);
    });

    it('answers empty for an org with nothing owed', async () => {
        const { top, other } = await repo.owedBy({ ...SCOPE, orgId: 'org_b' });
        expect(top).toEqual([]);
        expect(other).toEqual({ clients: 0, amount: 0 });
    });
});
