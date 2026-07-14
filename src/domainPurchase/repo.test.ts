import { describe, it, expect, beforeEach } from 'vitest';
import { DomainPurchaseRepo } from './repo';
import { DOMAIN_PURCHASE_PENDING_KEY, DomainPurchase } from './schema';
import type { IDdb } from '../ddbPort';

process.env.DOMAIN_PURCHASES_TABLE = 'domain-purchases-test';

/**
 * Hand-written IDdb stub (no vi.mock, per CLAUDE.md §11) that understands
 * exactly the conditional writes DomainPurchaseRepo issues. It keeps the same
 * "the write wins only when the condition holds" semantics DynamoDB enforces.
 */
function makeStubDdb() {
    const store = new Map<string, any>();
    const keyOf = (k: any) => `${k.orgId}|${k.purchaseId}`;

    const condFail = () => {
        const err: any = new Error('conditional failed');
        err.name = 'ConditionalCheckFailedException';
        throw err;
    };

    const ddb = {
        async getItem(_t: string, key: any) {
            return { Item: store.get(keyOf(key)) };
        },
        async transactWrite(items: any[]) {
            for (const { Put } of items) {
                if (Put.ConditionExpression?.includes('attribute_not_exists(purchaseId)') && store.has(keyOf(Put.Item))) {
                    const err: any = new Error('conditional failed');
                    err.name = 'TransactionCanceledException';
                    err.CancellationReasons = [{ Code: 'ConditionalCheckFailed' }];
                    throw err;
                }
            }
            for (const { Put } of items) store.set(keyOf(Put.Item), { ...Put.Item });
            return {};
        },
        async update(_t: string, key: any, params: any) {
            const item = store.get(keyOf(key));
            const values = params.ExpressionAttributeValues ?? {};
            const names = params.ExpressionAttributeNames ?? {};
            const cond = params.ConditionExpression ?? '';
            const expr: string = params.UpdateExpression;

            if (cond.includes('attribute_exists(purchaseId)') && !item) condFail();

            // claimRegisterAttempt
            if (expr === 'SET registerClaimedAt = :now, updatedAt = :now') {
                const held = item.registerClaimedAt;
                const ok = item.status === 'pending_payment'
                    && item.operationId === undefined
                    && (held === undefined || held < values[':stale']);
                if (!ok) condFail();
                item.registerClaimedAt = values[':now'];
                item.updatedAt = values[':now'];
                return {};
            }

            // setPaymentIntent
            if (expr === 'SET stripePaymentIntentId = :pi, updatedAt = :now') {
                if (item.stripePaymentIntentId !== undefined) condFail();
                item.stripePaymentIntentId = values[':pi'];
                item.updatedAt = values[':now'];
                return {};
            }

            // claimAuthCodeEmail
            if (expr === 'SET authCodeEmailSentAt = :now, updatedAt = :now') {
                if (item.authCodeEmailSentAt !== undefined) condFail();
                item.authCodeEmailSentAt = values[':now'];
                item.updatedAt = values[':now'];
                return {};
            }

            // recordError
            if (expr === 'SET lastError = :err, updatedAt = :now') {
                item.lastError = values[':err'];
                item.updatedAt = values[':now'];
                return {};
            }

            // transition (SET #status = :to, updatedAt = :now, ...  [REMOVE #pendingKey])
            if (expr.startsWith('SET #status = :to')) {
                const fromValues = Object.keys(values)
                    .filter((k) => k.startsWith(':from'))
                    .map((k) => values[k]);
                if (!fromValues.includes(item.status)) condFail();
                item.status = values[':to'];
                item.updatedAt = values[':now'];
                for (const [nk, realName] of Object.entries(names)) {
                    if (nk.startsWith('#u_')) {
                        const vk = `:u_${(realName as string)}`;
                        if (vk in values) item[realName as string] = values[vk];
                    }
                }
                if (expr.includes('REMOVE #pendingKey')) delete item.pendingKey;
                else if (values[':pending'] !== undefined) item.pendingKey = values[':pending'];
                return {};
            }

            throw new Error(`stub: unhandled UpdateExpression: ${expr}`);
        },
        async query(params: any) {
            const values = params.ExpressionAttributeValues ?? {};
            let items = [...store.values()];
            if (params.IndexName) {
                items = items.filter((i) => i.pendingKey === values[':p']);
            } else {
                items = items.filter((i) => i.orgId === values[':orgId']);
            }
            return { Items: items, LastEvaluatedKey: undefined };
        },
    };
    return { ddb: ddb as unknown as IDdb, store };
}

const baseContact = {
    firstName: 'Joe', lastName: 'Smith', email: 'joe@example.com', phone: '0400000000',
    addressLine1: '1 St', city: 'Melbourne', state: 'VIC', zipCode: '3000', countryCode: 'AU',
};

const basePurchase = (over: Partial<DomainPurchase> = {}): DomainPurchase => ({
    orgId: 'org1',
    purchaseId: 'dp-abc',
    domain: 'joesmowing.com.au',
    tld: 'com.au',
    status: 'pending_payment',
    siteHost: 'joesmowing.dev.otosheets.site',
    registrantContact: baseContact,
    abn: '12345678901',
    quote: { registrationUsd: 10, renewalUsd: 12, amountAudCents: 2000, fxRate: 1.5, buffer: 1.3 },
    createdAt: 't0',
    updatedAt: 't0',
    ...over,
});

describe('DomainPurchaseRepo', () => {
    let repo: DomainPurchaseRepo;
    let store: Map<string, any>;

    beforeEach(() => {
        const stub = makeStubDdb();
        repo = new DomainPurchaseRepo(stub.ddb);
        store = stub.store;
    });

    it('create is conditional: first wins, replay of the deterministic id is a no-op', async () => {
        expect(await repo.create(basePurchase())).toBe(true);
        // pending_payment carries no pendingKey (watcher owes it nothing yet).
        expect(store.get('org1|dp-abc').pendingKey).toBeUndefined();

        expect(await repo.create(basePurchase({ status: 'registering' }))).toBe(false);
        // Loser did not overwrite the stored record.
        expect(store.get('org1|dp-abc').status).toBe('pending_payment');
    });

    it('transition guards on the from-state and maintains the sparse pendingKey', async () => {
        await repo.create(basePurchase());

        // pending_payment → registering adds the operationId + enters the sparse index.
        expect(await repo.transition('org1', 'dp-abc', ['pending_payment'], 'registering', { operationId: 'op-1' })).toBe(true);
        const rec = store.get('org1|dp-abc');
        expect(rec.status).toBe('registering');
        expect(rec.operationId).toBe('op-1');
        expect(rec.pendingKey).toBe(DOMAIN_PURCHASE_PENDING_KEY);

        // A replayed pending_payment→registering loses (already moved).
        expect(await repo.transition('org1', 'dp-abc', ['pending_payment'], 'registering', { operationId: 'op-2' })).toBe(false);
        expect(store.get('org1|dp-abc').operationId).toBe('op-1');
    });

    it('leaving the pending statuses removes the sparse pendingKey', async () => {
        await repo.create(basePurchase({ status: 'registered', pendingKey: DOMAIN_PURCHASE_PENDING_KEY }));
        expect(await repo.transition('org1', 'dp-abc', ['registered'], 'delegated', { delegatedAt: 't1' })).toBe(true);
        const rec = store.get('org1|dp-abc');
        expect(rec.status).toBe('delegated');
        expect(rec.pendingKey).toBeUndefined();
        expect(rec.delegatedAt).toBe('t1');
    });

    it('claimRegisterAttempt is single-flight and re-claimable only once stale', async () => {
        await repo.create(basePurchase());
        expect(await repo.claimRegisterAttempt('org1', 'dp-abc', '2026-01-01T00:10:00Z', '2026-01-01T00:00:00Z')).toBe(true);
        // Fresh claim held → a concurrent attempt loses.
        expect(await repo.claimRegisterAttempt('org1', 'dp-abc', '2026-01-01T00:11:00Z', '2026-01-01T00:05:00Z')).toBe(false);
        // Held claim now older than staleBefore → re-claim wins.
        expect(await repo.claimRegisterAttempt('org1', 'dp-abc', '2026-01-01T01:00:00Z', '2026-01-01T00:50:00Z')).toBe(true);
    });

    it('claimRegisterAttempt will not claim once an operationId exists', async () => {
        await repo.create(basePurchase({ operationId: 'op-1' }));
        expect(await repo.claimRegisterAttempt('org1', 'dp-abc', 't', 't0')).toBe(false);
    });

    it('setPaymentIntent stores exactly once (idempotent replay keeps the first value)', async () => {
        await repo.create(basePurchase());
        await repo.setPaymentIntent('org1', 'dp-abc', 'pi_1');
        await repo.setPaymentIntent('org1', 'dp-abc', 'pi_2');
        expect(store.get('org1|dp-abc').stripePaymentIntentId).toBe('pi_1');
    });

    it('claimAuthCodeEmail wins exactly once (sent-marker before send)', async () => {
        await repo.create(basePurchase({ status: 'registered' }));
        expect(await repo.claimAuthCodeEmail('org1', 'dp-abc')).toBe(true);
        expect(await repo.claimAuthCodeEmail('org1', 'dp-abc')).toBe(false);
    });

    it('listPending returns only in-flight purchases (sparse index)', async () => {
        await repo.create(basePurchase({ purchaseId: 'dp-1', status: 'registering', pendingKey: DOMAIN_PURCHASE_PENDING_KEY }));
        await repo.create(basePurchase({ purchaseId: 'dp-2', status: 'registered', pendingKey: DOMAIN_PURCHASE_PENDING_KEY }));
        await repo.create(basePurchase({ purchaseId: 'dp-3', status: 'delegated' }));
        await repo.create(basePurchase({ purchaseId: 'dp-4', status: 'pending_payment' }));

        const pending = await repo.listPending();
        expect(pending.map((p) => p.purchaseId).sort()).toEqual(['dp-1', 'dp-2']);
    });

    it('listByOrg returns the org rows and get fetches by key', async () => {
        await repo.create(basePurchase({ purchaseId: 'dp-1' }));
        await repo.create(basePurchase({ purchaseId: 'dp-2' }));
        const { items } = await repo.listByOrg('org1', 20);
        expect(items.map((p) => p.purchaseId).sort()).toEqual(['dp-1', 'dp-2']);
        expect((await repo.get('org1', 'dp-1'))?.purchaseId).toBe('dp-1');
        expect(await repo.get('org1', 'nope')).toBeNull();
    });
});
