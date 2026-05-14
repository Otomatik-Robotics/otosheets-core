"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrgChannelRepo = void 0;
const tables_1 = require("../tables");
class OrgChannelRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getOrgChannel(orgId, channelId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.ORG_CHANNELS, { orgId, channelId });
        return Item ?? null;
    }
    async listOrgChannels(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.ORG_CHANNELS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return Items ?? [];
    }
    async createOrgChannel(orgId, channelId, data) {
        await this.ddb.put(tables_1.Tables.ORG_CHANNELS, {
            orgId,
            channelId,
            ...data,
            createdAt: new Date().toISOString(),
        });
    }
    async updateOrgChannel(orgId, channelId, updates) {
        const sets = [];
        const names = {};
        const values = {};
        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }
        await this.ddb.update(tables_1.Tables.ORG_CHANNELS, { orgId, channelId }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
    async deleteOrgChannel(orgId, channelId) {
        await this.ddb.delete(tables_1.Tables.ORG_CHANNELS, { orgId, channelId });
    }
}
exports.OrgChannelRepo = OrgChannelRepo;
//# sourceMappingURL=repo.js.map