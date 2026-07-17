import { describe, it, expect, beforeEach } from 'vitest';
import { OrderDynamoRepo } from './repo';
import { Order, orderIdFromSession } from './schema';
import type { IDdb } from '../ddbPort';

process.env.ORDERS_TABLE = 'orders-test';

function makeStubDdb() {
    const store = new Map<string, any>();
    const keyOf = (k: any) => `${k.orgId}|${k.orderId}`;
    const fail = () => { const e: any = new Error('cond'); e.name = 'ConditionalCheckFailedException'; throw e; };
    const ddb: IDdb = {
        async getItem(_t: string, key: any) { return { Item: store.get(keyOf(key)) } as any; },
        async put() { return {} as any; },
        async transactWrite(items: any[]) {
            for (const { Put } of items) {
                if (Put.ConditionExpression?.includes('attribute_not_exists') && store.has(keyOf(Put.Item))) {
                    const e: any = new Error('cancel'); e.name = 'TransactionCanceledException';
                    e.CancellationReasons = [{ Code: 'ConditionalCheckFailed' }]; throw e;
                }
            }
            for (const { Put } of items) store.set(keyOf(Put.Item), { ...Put.Item });
            return {} as any;
        },
        async update(_t: string, key: any, params: any) {
            const k = keyOf(key);
            let item = store.get(k);
            const vals = params.ExpressionAttributeValues ?? {};
            const ue: string = params.UpdateExpression ?? '';
            if (ue.startsWith('ADD seq')) {
                item = item ?? { ...key, seq: 0 };
                item.seq += vals[':one'];
                store.set(k, item);
                return { Attributes: { seq: item.seq } } as any;
            }
            if (!item) fail();
            const cond: string = params.ConditionExpression ?? '';
            if (cond.includes('attribute_not_exists(receiptSentAt)') && item.receiptSentAt) fail();
            if (cond.includes('#s IN')) {
                const froms = Object.entries(vals).filter(([kk]) => /^:f\d+$/.test(kk)).map(([, v]) => v);
                if (!froms.includes(item.status)) fail();
            }
            // apply SETs
            const names = params.ExpressionAttributeNames ?? {};
            if (vals[':to'] !== undefined) item.status = vals[':to'];
            if (ue.includes('receiptSentAt = :now')) item.receiptSentAt = vals[':now'];
            for (const [nk, attr] of Object.entries(names)) {
                if (nk === '#s') continue;
                const vk = ue.match(new RegExp(`${nk} = (:v\\d+)`))?.[1];
                if (vk) (item as any)[attr as string] = vals[vk];
            }
            store.set(k, item);
            return { Attributes: {} } as any;
        },
        async delete() { return {} as any; },
        async query() { return { Items: [] } as any; },
        async scan() { return { Items: [] } as any; },
        async batchGet() { return {} as any; },
        async batchWrite() { return {} as any; },
    };
    return { ddb, store };
}

function order(sessionId = 'cs_123', overrides: Partial<Order> = {}): Order {
    return {
        orgId: 'org1', orderId: orderIdFromSession(sessionId), orderNumber: 1, status: 'paid',
        buyer: { name: 'Aisha', email: 'a@x.com' }, lines: [], subtotalCents: 1000, shippingCents: 0,
        taxCents: 0, totalCents: 1000, currency: 'AUD', stripeSessionId: sessionId,
        createdAt: 'now', updatedAt: 'now', ...overrides,
    };
}

describe('OrderDynamoRepo', () => {
    let repo: OrderDynamoRepo;
    beforeEach(() => { repo = new OrderDynamoRepo(makeStubDdb().ddb); });

    it('nextOrderNumber increments atomically', async () => {
        expect(await repo.nextOrderNumber('org1')).toBe(1);
        expect(await repo.nextOrderNumber('org1')).toBe(2);
    });

    it('createConditional dedupes a webhook replay by deterministic id', async () => {
        expect(await repo.createConditional(order('cs_A'))).toBe(true);
        expect(await repo.createConditional(order('cs_A', { orderNumber: 9 }))).toBe(false);
    });

    it('updateStatus honours expectedFrom', async () => {
        await repo.createConditional(order('cs_B'));
        const id = orderIdFromSession('cs_B');
        expect(await repo.updateStatus('org1', id, ['paid', 'fulfilled'], 'shipped', { linkedInvoiceId: 'INV-1' })).toBe(true);
        // now status is 'shipped' — a paid-only transition must fail
        expect(await repo.updateStatus('org1', id, ['paid'], 'fulfilled')).toBe(false);
    });

    it('claimReceiptSend wins exactly once', async () => {
        await repo.createConditional(order('cs_C'));
        const id = orderIdFromSession('cs_C');
        expect(await repo.claimReceiptSend('org1', id)).toBe(true);
        expect(await repo.claimReceiptSend('org1', id)).toBe(false);
    });
});
