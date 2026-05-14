import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { Organization } from './schema';

export class OrgRepo {
    constructor(private ddb: IDdb) {}

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
}
