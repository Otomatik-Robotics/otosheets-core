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
    constructor(ddb: IDdb, scope: { orgId: string; businessProfileId: string }) {
        if (!scope.orgId.trim() || !scope.businessProfileId.trim()) throw new Error('Integration profile scope is required');
        this.scope = Object.freeze({ ...scope });
        this.repo = new IntegrationRepo(ddb);
    }
    async get(provider: string): Promise<Integration | null> {
        const item = await this.repo.getIntegration(this.scope.orgId, profileIntegrationKey(provider, this.scope.businessProfileId));
        if (item && (item.ownerId !== this.scope.orgId || item.config?.businessProfileId !== this.scope.businessProfileId)) throw new Error('Integration ownership mismatch');
        return item;
    }
    async put(provider: string, data: Record<string, any>): Promise<void> {
        if (data.ownerId !== undefined && data.ownerId !== this.scope.orgId) throw new Error('Integration ownership mismatch');
        if (data.config?.businessProfileId !== undefined && data.config.businessProfileId !== this.scope.businessProfileId) throw new Error('Integration ownership mismatch');
        const existing = await this.get(provider);
        await this.repo.putIntegration(this.scope.orgId, profileIntegrationKey(provider, this.scope.businessProfileId), {
            ...existing, ...data, ownerId: this.scope.orgId, provider: profileIntegrationKey(provider, this.scope.businessProfileId),
            ownerType: 'org', scope: 'business-profile',
            config: { ...(existing?.config ?? {}), ...(data.config ?? {}), businessProfileId: this.scope.businessProfileId },
        });
    }
    async delete(provider: string): Promise<void> {
        await this.repo.deleteIntegration(this.scope.orgId, profileIntegrationKey(provider, this.scope.businessProfileId));
    }
}
