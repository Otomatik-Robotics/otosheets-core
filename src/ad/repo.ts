import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { sk } from '../keys';
import { Ad } from './schema';

export class AdRepo {
    constructor(private ddb: IDdb) {}

    async getAd(orgId: string, userId: string, adId: string): Promise<Ad | null> {
        const { Item } = await this.ddb.getItem(Tables.ADS, { orgId, sk: sk(userId, adId) });
        return (Item as Ad) ?? null;
    }

    async listAllOrgAds(orgId: string): Promise<Ad[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.ADS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return (Items as Ad[]) ?? [];
    }

    async listUserAds(orgId: string, userId: string): Promise<Ad[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.ADS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `${userId}#` },
        });
        return (Items as Ad[]) ?? [];
    }

    async createAd(orgId: string, userId: string, adId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.ADS, {
            orgId,
            sk: sk(userId, adId),
            adId,
            createdBy: userId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }

    async deleteAd(orgId: string, userId: string, adId: string): Promise<void> {
        await this.ddb.delete(Tables.ADS, { orgId, sk: sk(userId, adId) });
    }

    async updateAd(orgId: string, userId: string, adId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = ['#updatedAt = :updatedAt'];
        const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
        const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };

        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }

        await this.ddb.update(Tables.ADS, { orgId, sk: sk(userId, adId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
}
