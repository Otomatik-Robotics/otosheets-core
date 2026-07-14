import { describe, it, expect, beforeEach } from 'vitest';
import { SiteRepo } from './repo';
import { DOMAINS_PENDING_KEY, postHostKey, Site, SitePost } from './schema';
import type { IDdb } from '../ddbPort';

process.env.SITES_TABLE = 'sites-test';

// In-memory IDdb stub covering the SiteRepo access patterns: keyed gets, the
// attribute_not_exists(host) create condition, pending-key sync, and the
// post-row transactions (Put/Update/Delete with posts.#pid registry writes).
function makeStubDdb() {
    const store = new Map<string, any>();

    const conditionFails = (expr: string | undefined, exists: boolean) =>
        (expr?.includes('attribute_not_exists') && exists) || (expr?.includes('attribute_exists') && !exists);

    function applyUpdate(key: any, params: any) {
        const item = store.get(key.host);
        if (conditionFails(params.ConditionExpression, store.has(key.host)) || !item) {
            const err: any = new Error('conditional failed');
            err.name = 'ConditionalCheckFailedException';
            throw err;
        }
        const v = params.ExpressionAttributeValues ?? {};
        const names = params.ExpressionAttributeNames ?? {};
        const expr: string = params.UpdateExpression;
        if (v[':d'] !== undefined) item.customDomains = v[':d'];
        if (expr.includes('domainsPendingKey = :p')) item.domainsPendingKey = v[':p'];
        if (expr.includes('REMOVE domainsPendingKey')) delete item.domainsPendingKey;
        if (expr.includes('posts = if_not_exists(posts, :empty)')) item.posts = item.posts ?? {};
        if (expr.includes('posts.#pid = :s')) { item.posts = item.posts ?? {}; item.posts[names['#pid']] = v[':s']; }
        if (expr.includes('REMOVE posts.#pid')) delete item.posts?.[names['#pid']];
        if (expr.includes('configVersion = configVersion + :one')) item.configVersion += v[':one'];
        if (expr.includes('updatedAt = :now')) item.updatedAt = v[':now'];
    }

    const ddb = {
        async getItem(_t: string, key: any) {
            return { Item: store.get(key.host) };
        },
        async transactWrite(items: any[]) {
            // Validate every condition before applying anything (all-or-nothing).
            for (const it of items) {
                const key = it.Put?.Item.host ?? it.Update?.Key.host ?? it.Delete?.Key.host;
                const expr = it.Put?.ConditionExpression ?? it.Update?.ConditionExpression ?? it.Delete?.ConditionExpression;
                if (conditionFails(expr, store.has(key))) {
                    const err: any = new Error('conditional failed');
                    err.name = 'TransactionCanceledException';
                    throw err;
                }
            }
            for (const it of items) {
                if (it.Put) store.set(it.Put.Item.host, { ...it.Put.Item });
                if (it.Delete) store.delete(it.Delete.Key.host);
                if (it.Update) applyUpdate(it.Update.Key, it.Update);
            }
            return {};
        },
        async update(_t: string, key: any, params: any) {
            applyUpdate(key, params);
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

    const basePost = (over: Partial<SitePost> = {}): SitePost => ({
        postId: 'p1', slug: 'spring-lawn-prep', title: 'Spring lawn prep',
        status: 'draft', siteSlug: 'joesmowing', blocks: [{ type: 'paragraph', spans: [{ text: 'Hello' }] }],
        createdAt: 't1', updatedAt: 't1', ...over,
    });

    it('createPost writes the row + registry summary and bumps configVersion', async () => {
        await repo.createSite(baseSite());
        await repo.createPost(basePost());

        const row = store.get(postHostKey('joesmowing', 'spring-lawn-prep'));
        expect(row.title).toBe('Spring lawn prep');
        expect(row.blocks).toHaveLength(1);
        const site = store.get('joesmowing');
        expect(site.posts.p1.slug).toBe('spring-lawn-prep');
        expect(site.posts.p1.blocks).toBeUndefined(); // summaries never carry bodies
        expect(site.configVersion).toBe(2);
    });

    it('createPost rejects a duplicate slug (conditional create) and leaves the registry untouched', async () => {
        await repo.createSite(baseSite());
        await repo.createPost(basePost());
        await expect(repo.createPost(basePost({ postId: 'p2', title: 'Different title, same slug' })))
            .rejects.toThrow();
        const site = store.get('joesmowing');
        expect(Object.keys(site.posts)).toEqual(['p1']);
        expect(site.posts.p1.title).toBe('Spring lawn prep');
    });

    it('putPost replaces the body and keeps the registry summary in sync', async () => {
        await repo.createSite(baseSite());
        await repo.createPost(basePost());
        await repo.putPost(basePost({ title: 'Updated title', status: 'published', publishedAt: 't2', updatedAt: 't2' }));

        expect(store.get(postHostKey('joesmowing', 'spring-lawn-prep')).title).toBe('Updated title');
        const summary = store.get('joesmowing').posts.p1;
        expect(summary.status).toBe('published');
        expect(summary.publishedAt).toBe('t2');
        expect(store.get('joesmowing').configVersion).toBe(3);
    });

    it('deletePost removes the row + registry entry and is idempotent', async () => {
        await repo.createSite(baseSite());
        await repo.createPost(basePost());
        await repo.deletePost('joesmowing', 'spring-lawn-prep', 'p1');
        expect(store.get(postHostKey('joesmowing', 'spring-lawn-prep'))).toBeUndefined();
        expect(store.get('joesmowing').posts.p1).toBeUndefined();
        await repo.deletePost('joesmowing', 'spring-lawn-prep', 'p1'); // second run: no-op, no throw
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
