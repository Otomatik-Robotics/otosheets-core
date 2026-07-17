import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { OrderPgRepo } from './repo.pg';
import type { Order } from './schema';

let db: PgDb;
let repo: OrderPgRepo;

const order = (over: Partial<Order> = {}): Order => ({
    orgId: 'org_1', orderId: 'ord-cs_1', orderNumber: 1, status: 'paid',
    buyer: { name: 'Vera', email: 'vera@x.com' },
    lines: [{ productId: 'p1', title: 'Widget', qty: 1, unitPriceCents: 4900, lineTotalCents: 4900 }] as any,
    subtotalCents: 4900, shippingCents: 0, taxCents: 0, totalCents: 4900, currency: 'AUD',
    stripeSessionId: 'cs_1',
    createdAt: '2026-07-17T01:00:00.000Z', updatedAt: '2026-07-17T01:00:00.000Z',
    ...over,
});

beforeAll(async () => {
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    await pglite.query("INSERT INTO orgs (org_id, name) VALUES ('org_1', 'Acme')");
    repo = new OrderPgRepo(db);
});

describe('OrderPgRepo', () => {
    it('sequential order numbers + monotonic counter sync', async () => {
        expect(await repo.nextOrderNumber('org_1')).toBe(1);
        expect(await repo.nextOrderNumber('org_1')).toBe(2);
        await repo.syncOrderCounter('org_1', 10);   // raise
        expect(await repo.nextOrderNumber('org_1')).toBe(11);
        await repo.syncOrderCounter('org_1', 5);    // never lowers
        expect(await repo.nextOrderNumber('org_1')).toBe(12);
    });

    it('createConditional is webhook-replay safe', async () => {
        expect(await repo.createConditional(order())).toBe(true);
        expect(await repo.createConditional(order())).toBe(false); // replay
        const got = await repo.get('org_1', 'ord-cs_1');
        expect(got?.totalCents).toBe(4900);
        expect(got?.buyer.email).toBe('vera@x.com');
    });

    it('updateStatus honours the expected-from set and whitelisted extras', async () => {
        expect(await repo.updateStatus('org_1', 'ord-cs_1', ['pending'], 'cancelled')).toBe(false); // paid ∉ [pending]
        expect(await repo.updateStatus('org_1', 'ord-cs_1', ['paid'], 'fulfilled', { fulfilment: { note: 'left at door' } })).toBe(true);
        const got = await repo.get('org_1', 'ord-cs_1');
        expect(got?.status).toBe('fulfilled');
        expect(got?.fulfilment?.note).toBe('left at door');
    });

    it('claimReceiptSend wins exactly once', async () => {
        expect(await repo.claimReceiptSend('org_1', 'ord-cs_1')).toBe(true);
        expect(await repo.claimReceiptSend('org_1', 'ord-cs_1')).toBe(false);
    });

    it('listByOrg pages newest-first with a keyset cursor', async () => {
        await repo.createConditional(order({ orderId: 'ord-cs_2', orderNumber: 2, createdAt: '2026-07-17T02:00:00.000Z', updatedAt: '2026-07-17T02:00:00.000Z', stripeSessionId: 'cs_2' }));
        await repo.createConditional(order({ orderId: 'ord-cs_3', orderNumber: 3, createdAt: '2026-07-17T03:00:00.000Z', updatedAt: '2026-07-17T03:00:00.000Z', stripeSessionId: 'cs_3', status: 'refunded' }));
        const p1 = await repo.listByOrg('org_1', { limit: 2 });
        expect(p1.items.map(o => o.orderId)).toEqual(['ord-cs_3', 'ord-cs_2']);
        expect(p1.lastEvaluatedKey).toBeTruthy();
        const p2 = await repo.listByOrg('org_1', { limit: 2, exclusiveStartKey: p1.lastEvaluatedKey });
        expect(p2.items.map(o => o.orderId)).toEqual(['ord-cs_1']);
        const refunded = await repo.listByOrg('org_1', { status: 'refunded' });
        expect(refunded.items).toHaveLength(1);
    });

    it('dailyTotals counts paid/fulfilled/shipped only, grouped by day', async () => {
        const t = await repo.dailyTotals('org_1', '2026-07-01T00:00:00.000Z', '2026-07-31T23:59:59.999Z');
        // ord-cs_1 (fulfilled) + ord-cs_2 (paid) count; ord-cs_3 (refunded) excluded.
        expect(t).toEqual([{ day: '2026-07-17', orders: 2, revenueCents: 9800 }]);
    });

    it('upsert is last-writer-wins on updated_at', async () => {
        await repo.upsert(order({ totalCents: 1, updatedAt: '2026-07-16T00:00:00.000Z' })); // stale — ignored
        expect((await repo.get('org_1', 'ord-cs_1'))?.totalCents).toBe(4900);
        await repo.upsert(order({ status: 'shipped', updatedAt: '2026-07-18T00:00:00.000Z' }));
        expect((await repo.get('org_1', 'ord-cs_1'))?.status).toBe('shipped');
    });
});
