import { randomUUID } from 'node:crypto';
import { Tables } from '../tables';
import type { IDdb } from '../ddbPort';
import { IntegrationRepo } from './repo';
import type { Integration } from './schema';

export function profileIntegrationKey(provider: string, businessProfileId: string): string {
    if (!provider.trim() || !businessProfileId.trim()) throw new Error('Integration profile scope is required');
    return `${provider}:profile:${businessProfileId}`;
}

/** Profile credentials never fall back to a legacy organisation-wide connection. */
export class BusinessProfileIntegrationRepo {
    private readonly repo: IntegrationRepo;
    private readonly scope: Readonly<{ orgId: string; businessProfileId: string }>;
    constructor(private readonly ddb: IDdb, scope: { orgId: string; businessProfileId: string }) {
        if (!scope.orgId.trim() || !scope.businessProfileId.trim()) throw new Error('Integration profile scope is required');
        this.scope = Object.freeze({ ...scope });
        this.repo = new IntegrationRepo(ddb);
    }
    async get(provider: string): Promise<Integration | null> {
        const item = await this.repo.getIntegration(this.scope.orgId, profileIntegrationKey(provider, this.scope.businessProfileId));
        if (item && (item.ownerId !== this.scope.orgId || item.config?.businessProfileId !== this.scope.businessProfileId)) throw new Error('Integration ownership mismatch');
        return item;
    }
    private validate(data: Record<string, any>) {
        if (data.ownerId !== undefined && data.ownerId !== this.scope.orgId) throw new Error('Integration ownership mismatch');
        if (data.config?.businessProfileId !== undefined && data.config.businessProfileId !== this.scope.businessProfileId) throw new Error('Integration ownership mismatch');
    }
    private item(provider: string, data: Record<string, any>): Integration {
        const now = new Date().toISOString();
        return {
            ...data, ownerId: this.scope.orgId, provider: profileIntegrationKey(provider, this.scope.businessProfileId),
            ownerType: 'org', scope: 'business-profile', connectionVersion: randomUUID(),
            config: { ...(data.config ?? {}), businessProfileId: this.scope.businessProfileId },
            createdAt: data.createdAt ?? now, updatedAt: now,
        };
    }
    /** Only explicit, verified OAuth completion may create or replace a connection. */
    async connect(provider: string, data: Record<string, any>): Promise<Integration> {
        this.validate(data);
        const item = this.item(provider, data);
        await this.ddb.put(Tables.INTEGRATIONS, item);
        return item;
    }
    /** Update only the exact connection snapshot used by the caller. Never retry stale credentials. */
    async put(provider: string, data: Record<string, any>, expectedVersion: string): Promise<Integration> {
        this.validate(data);
        if (!expectedVersion) throw new Error('Connection version is required');
        const existing = await this.get(provider);
        if (!existing || existing.connectionVersion !== expectedVersion) throw new Error('Accounting connection changed; reload before updating');
        const item = this.item(provider, { ...existing, ...data, config: { ...existing.config, ...data.config } });
        await this.ddb.transactWrite([{ Put: {
            TableName: Tables.INTEGRATIONS,
            Item: item,
            ConditionExpression: '#version = :expected',
            ExpressionAttributeNames: { '#version': 'connectionVersion' },
            ExpressionAttributeValues: { ':expected': expectedVersion },
        } }]);
        return item;
    }
    async delete(provider: string): Promise<void> {
        await this.repo.deleteIntegration(this.scope.orgId, profileIntegrationKey(provider, this.scope.businessProfileId));
    }
}
