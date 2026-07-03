import { describe, it, expect, beforeEach } from 'vitest';
import { SiteRepo } from './repo';
import { DOMAINS_PENDING_KEY, Site } from './schema';
import type { IDdb } from '../ddbPort';

process.env.SITES_TABLE = 'sites-test';

// In-memory IDdb stub covering the SiteRepo access patterns: keyed gets, the
// attribute_not_exists(host) create condition, and pending-key sync on update.
function makeStubDdb() {
    const store = new Map<string, any>();
    const ddb = {
        async getItem(_t: string, key: any) {
            return { Item: store.get(key.host) };
        },
        async transactWrite(items: any[]) {
            for (const { Put } of items) {
                if (Put.ConditionExpression?.includes('attribute_not_exists') && store.has(Put.Item.host)) {
                    const err: any = new Error('conditional failed');
                    err.name = 'TransactionCanceledException';
                    throw err;
                }
            }
            for (const { Put } of items) store.set(Put.Item.host, { ...Put.Item });
            return {};
        },
        async update(_t: string, key: any, params: any) {
            const item = store.get(key.host);
            if (!item) {
                const err: any = new Error('conditional failed');
                err.name = 'ConditionalCheckFailedException';
                throw err;
            }
            const v = params.ExpressionAttributeValues ?? {};
            if (v[':d'] !== undefined) item.customDomains = v[':d'];
            if (params.UpdateExpression.includes('domainsPendingKey = :p')) item.domainsPendingKey = v[':p'];
            if (params.UpdateExpression.includes('REMOVE domainsPendingKey')) delete item.domainsPendingKey;
            return {};
        },
        async query() { return { Items: [] }; },
    };
    return { ddb: ddb as unknown as IDdb, store };
}

const baseSite = (over: Partial<Site> = {}): Site => ({
    host: 'joesmowing', type: 'site', orgId: 'org1', slug: 'joesmowing',
    templateId: 'industrial-bold', status: 'draft', config: {}, configVersion: 1,
    customDomains: [], createdAt: 't0', updatedAt: 't0', ...over,
});

describe('SiteRepo', () => {
    let repo: SiteRepo;
    let store: Map<string, any>;

    beforeEach(() => {
        const stub = makeStubDdb();
        repo = new SiteRepo(stub.ddb);
        store = stub.store;
    });

    it('createSite rejects when the host is already claimed', async () => {
        await repo.createSite(baseSite());
        await expect(repo.createSite(baseSite({ orgId: 'org2' }))).rejects.toThrow();
        expect(store.get('joesmowing').orgId).toBe('org1');
    });

    it('resolveHost follows alias rows to the canonical site', async () => {
        await repo.createSite(baseSite());
        await repo.createAlias(baseSite({ host: 'www.joesmowing.com.au', type: 'alias', aliasOf: 'joesmowing' }));

        const resolved = await repo.resolveHost('www.joesmowing.com.au');
        expect(resolved?.host).toBe('joesmowing');
        expect(resolved?.type).toBe('site');
    });

    it('resolveHost returns null for unknown hosts', async () => {
        expect(await repo.resolveHost('nope')).toBeNull();
    });

    it('setCustomDomains sets the sparse pending key while a domain is in flight and clears it when terminal', async () => {
        await repo.createSite(baseSite());

        await repo.setCustomDomains('joesmowing', [
            { domain: 'joesmowing.com.au', status: 'pending_ns', requestedAt: 't1' },
        ]);
        expect(store.get('joesmowing').domainsPendingKey).toBe(DOMAINS_PENDING_KEY);

        await repo.setCustomDomains('joesmowing', [
            { domain: 'joesmowing.com.au', status: 'attached', requestedAt: 't1' },
        ]);
        expect(store.get('joesmowing').domainsPendingKey).toBeUndefined();
    });
});
