import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { Organization } from './schema';

/** Store-agnostic contract — implemented by OrgDynamoRepo and OrgPgRepo; OrgRepo (factory.ts) routes between them. */
export interface IOrgRepo {
    getOrg(orgId: string): Promise<Organization | null>;
    getOrgBySlug(slug: string): Promise<Organization | null>;
    createOrg(orgId: string, data: Record<string, any>): Promise<void>;
    updateOrg(orgId: string, updates: Record<string, any>): Promise<void>;
    /**
     * Atomically claim the org's active business profile — sets
     * `businessProfileId` only if it is currently unset. Returns whether this
     * call won the claim and the id that is now authoritative (on a loss, the
     * winner's id). The lazy seeding path relies on this so concurrent first
     * requests on a profile-less org converge on a single profile instead of
     * each minting one (idempotency standard §2).
     */
    setBusinessProfileIdIfUnset(
        orgId: string,
        businessProfileId: string,
    ): Promise<{ won: boolean; businessProfileId: string }>;
    /** Full-entity mirror upsert used by the dual-write router (plan §6.1). */
    upsertOrg(org: Organization): Promise<void>;
}

export class OrgDynamoRepo implements IOrgRepo {
    constructor(private ddb: IDdb) {}

    async upsertOrg(org: Organization): Promise<void> {
        await this.ddb.put(Tables.ORGANIZATIONS, org);
    }

    async getOrg(orgId: string): Promise<Organization | null> {
        const { Item } = await this.ddb.getItem(Tables.ORGANIZATIONS, { orgId });
        return (Item as Organization) ?? null;
    }

    async getOrgBySlug(slug: string): Promise<Organization | null> {
        const { Items } = await this.ddb.query({
            TableName: Tables.ORGANIZATIONS,
            IndexName: 'SlugIndex',
            KeyConditionExpression: 'slug = :slug',
            ExpressionAttributeValues: { ':slug': slug },
            Limit: 1,
        });
        return (Items?.[0] as Organization) ?? null;
    }

    async createOrg(orgId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.ORGANIZATIONS, {
            orgId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }

    async updateOrg(orgId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = ['#updatedAt = :updatedAt'];
        const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
        const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };

        for (const [key, val] of Object.entries(updates)) {
            const attr = `#${key}`;
            const placeholder = `:${key}`;
            sets.push(`${attr} = ${placeholder}`);
            names[attr] = key;
            values[placeholder] = val;
        }

        await this.ddb.update(Tables.ORGANIZATIONS, { orgId }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }

    async setBusinessProfileIdIfUnset(
        orgId: string,
        businessProfileId: string,
    ): Promise<{ won: boolean; businessProfileId: string }> {
        try {
            await this.ddb.update(Tables.ORGANIZATIONS, { orgId }, {
                UpdateExpression: 'SET #bp = :bp, #updatedAt = :updatedAt',
                ConditionExpression: 'attribute_exists(orgId) AND attribute_not_exists(#bp)',
                ExpressionAttributeNames: { '#bp': 'businessProfileId', '#updatedAt': 'updatedAt' },
                ExpressionAttributeValues: { ':bp': businessProfileId, ':updatedAt': new Date().toISOString() },
            });
            return { won: true, businessProfileId };
        } catch (err: any) {
            // Lost the race (or already set) — re-read and defer to the winner.
            if (err?.name !== 'ConditionalCheckFailedException') throw err;
            const existing = await this.getOrg(orgId);
            return { won: false, businessProfileId: existing?.businessProfileId ?? businessProfileId };
        }
    }
}
