import { describe, it, expect, beforeEach } from 'vitest';
import { InvoiceRepo } from './repo';
import { sk } from '../keys';
import type { IDdb } from '../ddbPort';

// Minimal in-memory IDdb stub — implements only what these tests use.
function makeStubDdb() {
    const store = new Map<string, any>();
    const keyOf = (key: any) => `${key.orgId}|${key.sk}`;
    const ddb = {
        async getItem(_t: string, key: any) {
            return { Item: store.get(keyOf(key)) };
        },
        async put(_t: string, item: any) {
            store.set(keyOf(item), { ...item });
            return {};
        },
        async update(_t: string, key: any, params: Record<string, any>) {
            const existing = store.get(keyOf(key));
            if (params.ConditionExpression === 'attribute_exists(sk)' && !existing) {
                const err = new Error('The conditional request failed');
                (err as any).name = 'ConditionalCheckFailedException';
                throw err;
            }
            const item = existing ?? { ...key };
            for (const [placeholder, attr] of Object.entries(params.ExpressionAttributeNames ?? {})) {
                const valueKey = placeholder.replace('#', ':');
                if (valueKey in (params.ExpressionAttributeValues ?? {})) {
                    item[attr as string] = params.ExpressionAttributeValues[valueKey];
                }
            }
            store.set(keyOf(key), item);
            return {};
        },
        async query(params: any) {
            const orgId = params.ExpressionAttributeValues[':orgId'];
            const invoiceId = params.ExpressionAttributeValues[':invoiceId'];
            const Items = [...store.values()].filter(i => i.orgId === orgId && i.invoiceId === invoiceId);
            return { Items };
        },
    };
    return { ddb: ddb as unknown as IDdb, store };
}

describe('InvoiceRepo.findInvoiceByIdInOrg', () => {
    let repo: InvoiceRepo;
    let store: Map<string, any>;

    beforeEach(() => {
        const stub = makeStubDdb();
        repo = new InvoiceRepo(stub.ddb);
        store = stub.store;
    });

    it('derives ownerId from the sort key, not createdBy', async () => {
        store.set(`org1|${sk('owner-user', 'inv1')}`, {
            orgId: 'org1',
            sk: sk('owner-user', 'inv1'),
            invoiceId: 'inv1',
            createdBy: 'someone-else',
            items: [{ description: 'x', quantity: 1, unitPrice: 100 }],
        });

        const result = await repo.findInvoiceByIdInOrg('org1', 'inv1');

        expect(result).not.toBeNull();
        expect(result!.ownerId).toBe('owner-user');
    });

    it('falls back to createdBy when the item has no sk attribute', async () => {
        store.set(`org1|${sk('owner-user', 'inv1')}`, {
            orgId: 'org1',
            invoiceId: 'inv1',
            createdBy: 'creator-user',
        });

        const result = await repo.findInvoiceByIdInOrg('org1', 'inv1');

        expect(result!.ownerId).toBe('creator-user');
    });

    it('returns null when no invoice matches', async () => {
        expect(await repo.findInvoiceByIdInOrg('org1', 'missing')).toBeNull();
    });
});

describe('InvoiceRepo.updateInvoice', () => {
    let repo: InvoiceRepo;
    let store: Map<string, any>;

    beforeEach(() => {
        const stub = makeStubDdb();
        repo = new InvoiceRepo(stub.ddb);
        store = stub.store;
    });

    it('updates an existing invoice and preserves items', async () => {
        const key = `org1|${sk('user1', 'inv1')}`;
        store.set(key, {
            orgId: 'org1',
            sk: sk('user1', 'inv1'),
            invoiceId: 'inv1',
            status: 'DRAFT',
            items: [{ description: 'x', quantity: 1, unitPrice: 100 }],
        });

        await repo.updateInvoice('org1', 'user1', 'inv1', { status: 'SENT' });

        const item = store.get(key);
        expect(item.status).toBe('SENT');
        expect(item.items).toHaveLength(1);
    });

    it('rejects instead of creating a sparse shadow record when the key does not exist', async () => {
        await expect(
            repo.updateInvoice('org1', 'wrong-user', 'inv1', { status: 'SENT' }),
        ).rejects.toThrow();

        expect(store.has(`org1|${sk('wrong-user', 'inv1')}`)).toBe(false);
    });
});
