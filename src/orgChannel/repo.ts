import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { OrgChannel } from './schema';

export class OrgChannelRepo {
    constructor(private ddb: IDdb) {}

    async getOrgChannel(orgId: string, channelId: string): Promise<OrgChannel | null> {
        const { Item } = await this.ddb.getItem(Tables.ORG_CHANNELS, { orgId, channelId });
        return (Item as OrgChannel) ?? null;
    }

    async listOrgChannels(orgId: string): Promise<OrgChannel[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.ORG_CHANNELS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return (Items as OrgChannel[]) ?? [];
    }

    async createOrgChannel(orgId: string, channelId: string, data: Record<string, any>): Promise<void> {
        await this.ddb.put(Tables.ORG_CHANNELS, {
            orgId,
            channelId,
            ...data,
            createdAt: new Date().toISOString(),
        });
    }

    async updateOrgChannel(orgId: string, channelId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = [];
        const names: Record<string, string> = {};
        const values: Record<string, any> = {};

        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }

        await this.ddb.update(Tables.ORG_CHANNELS, { orgId, channelId }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }

    async deleteOrgChannel(orgId: string, channelId: string): Promise<void> {
        await this.ddb.delete(Tables.ORG_CHANNELS, { orgId, channelId });
    }
}
