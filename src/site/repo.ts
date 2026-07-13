import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import {
    DOMAINS_PENDING_KEY, postHostKey, Site, SiteAsset, SiteCustomDomain,
    SitePost, SitePostSummary, SiteTemplateId,
} from './schema';

export class SiteRepo {
    constructor(private ddb: IDdb) {}

    async getByHost(host: string): Promise<Site | null> {
        const { Item } = await this.ddb.getItem(Tables.SITES, { host });
        return (Item as Site) ?? null;
    }

    /** Renderer lookup: resolves alias rows (custom domains) to their canonical site. */
    async resolveHost(host: string): Promise<Site | null> {
        const row = await this.getByHost(host);
        if (!row) return null;
        if (row.type === 'alias' && row.aliasOf) return this.getByHost(row.aliasOf);
        return row;
    }

    async listByOrg(orgId: string): Promise<Site[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.SITES,
            IndexName: 'ByOrg',
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return (Items as Site[]) ?? [];
    }

    /** Idempotent create — fails if the host is already claimed (by anyone). */
    async createSite(site: Site): Promise<void> {
        await this.ddb.transactWrite([
            {
                Put: {
                    TableName: Tables.SITES,
                    Item: site,
                    ConditionExpression: 'attribute_not_exists(host)',
                },
            },
        ]);
    }

    /** Alias row for a custom domain pointing at a canonical site. */
    async createAlias(alias: Site): Promise<void> {
        await this.createSite(alias);
    }

    async updateConfig(host: string, config: Record<string, unknown>): Promise<void> {
        await this.ddb.update(Tables.SITES, { host }, {
            UpdateExpression: 'SET config = :c, configVersion = configVersion + :one, updatedAt = :now',
            ConditionExpression: 'attribute_exists(host)',
            ExpressionAttributeValues: {
                ':c': config,
                ':one': 1,
                ':now': new Date().toISOString(),
            },
        });
    }

    async setTemplate(host: string, templateId: SiteTemplateId): Promise<void> {
        await this.ddb.update(Tables.SITES, { host }, {
            UpdateExpression: 'SET templateId = :t, configVersion = configVersion + :one, updatedAt = :now',
            ConditionExpression: 'attribute_exists(host)',
            ExpressionAttributeValues: {
                ':t': templateId,
                ':one': 1,
                ':now': new Date().toISOString(),
            },
        });
    }

    async setStatus(host: string, status: Site['status']): Promise<void> {
        const now = new Date().toISOString();
        const params: Record<string, any> = {
            UpdateExpression: 'SET #s = :s, updatedAt = :now',
            ConditionExpression: 'attribute_exists(host)',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':s': status, ':now': now },
        };
        if (status === 'published') {
            params.UpdateExpression += ', publishedAt = if_not_exists(publishedAt, :now)';
        }
        await this.ddb.update(Tables.SITES, { host }, params);
    }

    /** Replaces the customDomains list and keeps the sparse DomainsPending GSI attribute in sync. */
    async setCustomDomains(host: string, customDomains: SiteCustomDomain[]): Promise<void> {
        const pending = customDomains.some(d => !['attached', 'failed'].includes(d.status));
        const params: Record<string, any> = {
            ConditionExpression: 'attribute_exists(host)',
            ExpressionAttributeValues: {
                ':d': customDomains,
                ':now': new Date().toISOString(),
            },
        };
        if (pending) {
            params.UpdateExpression = 'SET customDomains = :d, updatedAt = :now, domainsPendingKey = :p';
            params.ExpressionAttributeValues[':p'] = DOMAINS_PENDING_KEY;
        } else {
            params.UpdateExpression = 'SET customDomains = :d, updatedAt = :now REMOVE domainsPendingKey';
        }
        await this.ddb.update(Tables.SITES, { host }, params);
    }

    /** Idempotent asset upsert — assetId is deterministic (derived from the S3 key). */
    async putAsset(host: string, asset: SiteAsset): Promise<void> {
        await this.ddb.update(Tables.SITES, { host }, {
            UpdateExpression: 'SET assets = if_not_exists(assets, :empty), updatedAt = :now',
            ConditionExpression: 'attribute_exists(host)',
            ExpressionAttributeValues: { ':empty': {}, ':now': new Date().toISOString() },
        });
        await this.ddb.update(Tables.SITES, { host }, {
            UpdateExpression: 'SET assets.#aid = if_not_exists(assets.#aid, :a), updatedAt = :now',
            ConditionExpression: 'attribute_exists(host)',
            ExpressionAttributeNames: { '#aid': asset.assetId },
            ExpressionAttributeValues: { ':a': asset, ':now': new Date().toISOString() },
        });
    }

    async removeAsset(host: string, assetId: string): Promise<void> {
        try {
            await this.ddb.update(Tables.SITES, { host }, {
                UpdateExpression: 'REMOVE assets.#aid SET updatedAt = :now',
                ConditionExpression: 'attribute_exists(host)',
                ExpressionAttributeNames: { '#aid': assetId },
                ExpressionAttributeValues: { ':now': new Date().toISOString() },
            });
        } catch (err: any) {
            if (err?.name !== 'ConditionalCheckFailedException') throw err;
        }
    }

    // ─── Site posts ("Updates" blog) ─────────────────────────────────────────
    // Bodies live in their own rows (PK = postHostKey); summaries live in the
    // site row's `posts` map so index/list surfaces need no extra reads. Every
    // registry write bumps configVersion — the renderer's cache-bust param.

    private postSummaryOf(post: SitePost): SitePostSummary {
        return {
            postId: post.postId,
            slug: post.slug,
            title: post.title,
            status: post.status,
            ...(post.heroImageUrl ? { heroImageUrl: post.heroImageUrl } : {}),
            ...(post.publishedAt ? { publishedAt: post.publishedAt } : {}),
            createdAt: post.createdAt,
            updatedAt: post.updatedAt,
        };
    }

    async getPost(siteSlug: string, postSlug: string): Promise<SitePost | null> {
        const { Item } = await this.ddb.getItem(Tables.SITES, { host: postHostKey(siteSlug, postSlug) });
        return (Item as SitePost) ?? null;
    }

    /**
     * Conditional create — the row key carries the slug, so creating the same
     * slug twice fails the condition (per-site slug uniqueness). Throws
     * TransactionCanceledException on collision; callers map it to a 409.
     */
    async createPost(post: SitePost): Promise<void> {
        // The posts map must exist before the transact's nested SET (idempotent,
        // same two-step shape as putAsset).
        await this.ddb.update(Tables.SITES, { host: post.siteSlug }, {
            UpdateExpression: 'SET posts = if_not_exists(posts, :empty)',
            ConditionExpression: 'attribute_exists(host)',
            ExpressionAttributeValues: { ':empty': {} },
        });
        await this.ddb.transactWrite([
            {
                Put: {
                    TableName: Tables.SITES,
                    Item: { ...post, host: postHostKey(post.siteSlug, post.slug) },
                    ConditionExpression: 'attribute_not_exists(host)',
                },
            },
            {
                Update: {
                    TableName: Tables.SITES,
                    Key: { host: post.siteSlug },
                    UpdateExpression: 'SET posts.#pid = :s, configVersion = configVersion + :one, updatedAt = :now',
                    ConditionExpression: 'attribute_exists(host)',
                    ExpressionAttributeNames: { '#pid': post.postId },
                    ExpressionAttributeValues: {
                        ':s': this.postSummaryOf(post),
                        ':one': 1,
                        ':now': new Date().toISOString(),
                    },
                },
            },
        ]);
    }

    /** Replace the post row + its registry summary atomically (single-owner
     *  editing — last writer wins on the body; the row must already exist). */
    async putPost(post: SitePost): Promise<void> {
        await this.ddb.transactWrite([
            {
                Put: {
                    TableName: Tables.SITES,
                    Item: { ...post, host: postHostKey(post.siteSlug, post.slug) },
                    ConditionExpression: 'attribute_exists(host)',
                },
            },
            {
                Update: {
                    TableName: Tables.SITES,
                    Key: { host: post.siteSlug },
                    UpdateExpression: 'SET posts.#pid = :s, configVersion = configVersion + :one, updatedAt = :now',
                    ConditionExpression: 'attribute_exists(host)',
                    ExpressionAttributeNames: { '#pid': post.postId },
                    ExpressionAttributeValues: {
                        ':s': this.postSummaryOf(post),
                        ':one': 1,
                        ':now': new Date().toISOString(),
                    },
                },
            },
        ]);
    }

    /** Delete the post row + registry entry. Idempotent — a second run deletes
     *  nothing and the REMOVE of a missing map key is a no-op. */
    async deletePost(siteSlug: string, postSlug: string, postId: string): Promise<void> {
        await this.ddb.transactWrite([
            {
                Delete: {
                    TableName: Tables.SITES,
                    Key: { host: postHostKey(siteSlug, postSlug) },
                },
            },
            {
                Update: {
                    TableName: Tables.SITES,
                    Key: { host: siteSlug },
                    UpdateExpression: 'REMOVE posts.#pid SET configVersion = configVersion + :one, updatedAt = :now',
                    ConditionExpression: 'attribute_exists(host)',
                    ExpressionAttributeNames: { '#pid': postId },
                    ExpressionAttributeValues: { ':one': 1, ':now': new Date().toISOString() },
                },
            },
        ]);
    }

    /** DNS-watcher scan surface: only sites with an in-flight custom domain (sparse GSI). */
    async listDomainsPending(): Promise<Site[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.SITES,
            IndexName: 'DomainsPending',
            KeyConditionExpression: 'domainsPendingKey = :p',
            ExpressionAttributeValues: { ':p': DOMAINS_PENDING_KEY },
        });
        return (Items as Site[]) ?? [];
    }
}
