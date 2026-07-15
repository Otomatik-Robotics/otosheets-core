import { describe, it, expect, beforeEach } from 'vitest';
import { ProductRepo } from './repo';
import { Product } from './schema';
import type { IDdb } from '../ddbPort';

process.env.PRODUCTS_TABLE = 'products-test';

/** In-memory ddb that honours the conditional-create + stock-guard conditions we use. */
function makeStubDdb() {
    const store = new Map<string, any>();
    const keyOf = (k: any) => `${k.orgId}|${k.productId}`;
    const failCond = () => {
        const err: any = new Error('conditional failed');
        err.name = 'ConditionalCheckFailedException';
        throw err;
    };
    const ddb: IDdb = {
        async getItem(_t: string, key: any) {
            return { Item: store.get(keyOf(key)) } as any;
        },
        async put(_t: string, item: any) {
            store.set(keyOf(item), { ...item });
            return {} as any;
        },
        async transactWrite(items: any[]) {
            for (const { Put } of items) {
                if (Put.ConditionExpression?.includes('attribute_not_exists') && store.has(keyOf(Put.Item))) {
                    const err: any = new Error('cancel');
                    err.name = 'TransactionCanceledException';
                    err.CancellationReasons = [{ Code: 'ConditionalCheckFailed' }];
                    throw err;
                }
            }
            for (const { Put } of items) store.set(keyOf(Put.Item), { ...Put.Item });
            return {} as any;
        },
        async update(_t: string, key: any, params: any) {
            const item = store.get(keyOf(key));
            if (!item) failCond();
            const cond: string = params.ConditionExpression ?? '';
            const vals = params.ExpressionAttributeValues ?? {};
            // Decrement guard: variants[i].variantId = :vid AND variants[i].stock >= :q
            const m = /variants\[(\d+)\]\.stock/.exec(params.UpdateExpression ?? '');
            if (m) {
                const i = Number(m[1]);
                const v = item.variants[i];
                if (cond.includes('variantId = :vid') && v.variantId !== vals[':vid']) failCond();
                if (cond.includes('>= :q') && v.stock < vals[':q']) failCond();
                if (params.UpdateExpression.includes('- :q')) v.stock -= vals[':q'];
                else if (params.UpdateExpression.includes('+ :q')) v.stock += vals[':q'];
            }
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

function product(overrides: Partial<Product> = {}): Product {
    return {
        orgId: 'org1', productId: 'p1', slug: 'fiddle-leaf-fig',
        title: 'Fiddle Leaf Fig', description: '', images: [], status: 'active', sellable: true,
        shippingClass: 'physical', basePriceCents: 4800, currency: 'AUD', taxBehaviour: 'inclusive',
        variants: [
            { variantId: 'v-s', options: { Size: 'Small' }, priceCents: 4800, stock: 12 },
            { variantId: 'v-m', options: { Size: 'Medium' }, priceCents: 7200, stock: 3 },
            { variantId: 'v-l', options: { Size: 'Large' }, priceCents: 12800, stock: null },
        ],
        createdAt: 'now', updatedAt: 'now', ...overrides,
    };
}

describe('ProductRepo', () => {
    let repo: ProductRepo, store: Map<string, any>;
    beforeEach(() => { const s = makeStubDdb(); repo = new ProductRepo(s.ddb); store = s.store; });

    it('conditional create is idempotent on duplicate id', async () => {
        expect(await repo.create(product())).toBe(true);
        expect(await repo.create(product({ title: 'dupe' }))).toBe(false);
        expect(store.get('org1|p1').title).toBe('Fiddle Leaf Fig');
    });

    it('decrementVariantStock refuses to oversell', async () => {
        await repo.create(product());
        expect(await repo.decrementVariantStock('org1', 'p1', 'v-m', 3)).toBe(true);
        expect(store.get('org1|p1').variants[1].stock).toBe(0);
        expect(await repo.decrementVariantStock('org1', 'p1', 'v-m', 1)).toBe(false);
    });

    it('untracked variant always decrements to true (no change)', async () => {
        await repo.create(product());
        expect(await repo.decrementVariantStock('org1', 'p1', 'v-l', 99)).toBe(true);
        expect(store.get('org1|p1').variants[2].stock).toBeNull();
    });

    it('missing product / variant returns false', async () => {
        expect(await repo.decrementVariantStock('org1', 'nope', 'v-s', 1)).toBe(false);
        await repo.create(product());
        expect(await repo.decrementVariantStock('org1', 'p1', 'ghost', 1)).toBe(false);
    });
});
