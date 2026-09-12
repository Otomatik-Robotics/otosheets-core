import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { clients, invoices, invoicePayments } from '../pg/schema/billingCore';
import { jobs } from '../pg/schema/opsEntities';
import { ClientOverviewPgRepo } from './repo.pg';

let db: PgDb;

const D = (s: string) => new Date(s);

beforeAll(async () => {
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    await pglite.query("INSERT INTO orgs (org_id, name) VALUES ('org_1', 'Acme')");

    await db.insert(clients).values({
        clientId: 'c_1', orgId: 'org_1', createdBy: 'u_1', name: 'Vera Cruz',
        email: 'vera@cruz.com', createdAt: D('2026-01-01T00:00:00Z'), updatedAt: D('2026-01-01T00:00:00Z'),
    });
    // Another client's invoice must never leak into c_1's figures.
    await db.insert(clients).values({
        clientId: 'c_2', orgId: 'org_1', createdBy: 'u_1', name: 'Other Co',
        createdAt: D('2026-01-01T00:00:00Z'), updatedAt: D('2026-01-01T00:00:00Z'),
    });

    const inv = (o: any) => db.insert(invoices).values({
        orgId: 'org_1', ownerId: 'u_1', createdBy: 'u_1', ...o,
    });
    // i_1: fully paid, one payment 7 days after issue → avgPayDays contributor
    await inv({ invoiceId: 'i_1', invoiceNumber: 'INV-1', clientId: 'c_1', status: 'PAID',
        totalAmount: '1000', paidAmount: '1000', date: '2026-06-01', dueDate: '2026-06-15',
        createdAt: D('2026-06-01T10:00:00Z'), updatedAt: D('2026-06-08T10:00:00Z') });
    // i_2: open, not overdue (due far future)
    await inv({ invoiceId: 'i_2', invoiceNumber: 'INV-2', clientId: 'c_1', status: 'SENT',
        totalAmount: '500', paidAmount: '0', date: '2026-06-10', dueDate: '2099-01-01',
        createdAt: D('2026-06-10T10:00:00Z'), updatedAt: D('2026-06-10T10:00:00Z') });
    // i_3: overdue, partially paid → owed 200
    await inv({ invoiceId: 'i_3', invoiceNumber: 'INV-3', clientId: 'c_1', status: 'OVERDUE',
        totalAmount: '300', paidAmount: '100', date: '2020-01-01', dueDate: '2020-02-01',
        createdAt: D('2026-06-20T10:00:00Z'), updatedAt: D('2026-06-20T10:00:00Z') });
    // i_4: payment link — excluded from all money + counts
    await inv({ invoiceId: 'i_4', invoiceNumber: 'PL-1', clientId: 'c_1', status: 'SENT',
        totalAmount: '9999', paidAmount: '0', isPaymentLink: true,
        createdAt: D('2026-06-21T10:00:00Z'), updatedAt: D('2026-06-21T10:00:00Z') });
    // i_5: draft — counted, but owes nothing (not an open status)
    await inv({ invoiceId: 'i_5', invoiceNumber: 'INV-5', clientId: 'c_1', status: 'DRAFT',
        totalAmount: '700', paidAmount: '0',
        createdAt: D('2026-06-22T10:00:00Z'), updatedAt: D('2026-06-22T10:00:00Z') });
    // other client's invoice
    await inv({ invoiceId: 'i_x', invoiceNumber: 'INV-X', clientId: 'c_2', status: 'SENT',
        totalAmount: '4000', paidAmount: '0', dueDate: '2020-01-01',
        createdAt: D('2026-06-05T10:00:00Z'), updatedAt: D('2026-06-05T10:00:00Z') });

    await db.insert(invoicePayments).values({
        paymentId: 'p_1', invoiceId: 'i_1', orgId: 'org_1', amount: '1000', method: 'card',
        date: '2026-06-08', createdAt: D('2026-06-08T10:00:00Z'),
    });

    await db.insert(jobs).values({
        jobId: 'j_1', orgId: 'org_1', ownerId: 'u_1', createdBy: 'u_1', clientId: 'c_1',
        title: 'Gutter clean', status: 'COMPLETED', completedAt: '2026-06-18T09:00:00Z',
        createdAt: D('2026-06-15T10:00:00Z'), updatedAt: D('2026-06-18T10:00:00Z'),
    });
    await db.insert(jobs).values({
        jobId: 'j_2', orgId: 'org_1', ownerId: 'u_1', createdBy: 'u_1', clientId: 'c_1',
        title: 'Repaint', status: 'SCHEDULED',
        createdAt: D('2026-06-19T10:00:00Z'), updatedAt: D('2026-06-19T10:00:00Z'),
    });
});

describe('ClientOverviewPgRepo', () => {
    const repo = () => new ClientOverviewPgRepo(db);

    it('returns null for an unknown client', async () => {
        expect(await repo().getClientOverview('org_1', 'nope')).toBeNull();
    });

    it('aggregates KPIs from real invoices only, scoped to the client', async () => {
        const o = (await repo().getClientOverview('org_1', 'c_1'))!;
        expect(o.client.name).toBe('Vera Cruz');
        // i_1,i_2,i_3,i_5 are real (i_4 payment-link excluded); i_x belongs to c_2
        expect(o.kpis.invoiceCount).toBe(4);
        expect(o.kpis.paidInvoiceCount).toBe(1);
        expect(o.kpis.lifetimeValue).toBe(1100);   // 1000 + 0 + 100 + 0
        expect(o.kpis.outstanding).toBe(700);       // i_2 500 + i_3 200
        expect(o.kpis.overdue).toBe(200);           // only i_3 is past due
        expect(o.kpis.avgPayDays).toBe(7);          // i_1 paid 7 days after issue
    });

    it('lists recent invoices newest-first, excluding payment links', async () => {
        const o = (await repo().getClientOverview('org_1', 'c_1'))!;
        const nums = o.recentInvoices.map((i) => i.invoiceNumber);
        expect(nums).not.toContain('PL-1');
        expect(nums[0]).toBe('INV-5');              // newest createdAt
        expect(o.recentInvoices.every((i) => typeof i.totalAmount === 'number')).toBe(true);
    });

    it('batches per-client rollups in one query, scoped and link-excluding', async () => {
        const rollups = await repo().batchClientRollups('org_1', ['c_1', 'c_2', 'missing']);
        const byId = new Map(rollups.map((r) => [r.clientId, r]));

        const c1 = byId.get('c_1')!;
        expect(c1.invoiceCount).toBe(4);          // excludes the payment link
        expect(c1.lifetimeValue).toBe(1100);
        expect(c1.outstanding).toBe(700);
        expect(c1.overdue).toBe(200);

        // c_2's single overdue invoice must not bleed into c_1
        expect(byId.get('c_2')!.outstanding).toBe(4000);
        // unknown ids are simply absent
        expect(byId.has('missing')).toBe(false);
    });

    it('returns an empty array for no ids', async () => {
        expect(await repo().batchClientRollups('org_1', [])).toEqual([]);
    });

    it('counts ALL invoices for a client (incl. payment links + quotes) for the delete guard', async () => {
        // c_1 has i_1,i_2,i_3 (real) + i_4 (payment link) + i_5 (draft) = 5
        expect(await repo().clientInvoiceCount('org_1', 'c_1')).toBe(5);
        expect(await repo().clientInvoiceCount('org_1', 'c_2')).toBe(1);
        expect(await repo().clientInvoiceCount('org_1', 'nobody')).toBe(0);
    });

    it('builds a merged timeline sorted newest-first', async () => {
        const o = (await repo().getClientOverview('org_1', 'c_1'))!;
        const types = o.timeline.map((e) => e.type);
        expect(types).toContain('payment_received');
        expect(types).toContain('job_completed');
        expect(types).toContain('job_created');
        expect(types).toContain('client_created');
        expect(types).toContain('invoice_created');
        // strictly descending by `at`
        for (let i = 1; i < o.timeline.length; i++) {
            expect(o.timeline[i - 1].at >= o.timeline[i].at).toBe(true);
        }
        // client_created is the oldest event → last
        expect(o.timeline[o.timeline.length - 1].type).toBe('client_created');
    });
});
