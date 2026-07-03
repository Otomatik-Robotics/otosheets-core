import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { DOMAINS_PENDING_KEY, Site, SiteCustomDomain, SiteTemplateId } from './schema';

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
