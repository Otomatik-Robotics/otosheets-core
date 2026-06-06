"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdRepo = void 0;
const tables_1 = require("../tables");
const keys_1 = require("../keys");
class AdRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getAd(orgId, userId, adId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.ADS, { orgId, sk: (0, keys_1.sk)(userId, adId) });
        return Item ?? null;
    }
    async listAllOrgAds(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.ADS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return Items ?? [];
    }
    async listUserAds(orgId, userId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.ADS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `${userId}#` },
        });
        return Items ?? [];
    }
    async createAd(orgId, userId, adId, data) {
        const now = new Date().toISOString();
        await this.ddb.put(tables_1.Tables.ADS, {
            orgId,
            sk: (0, keys_1.sk)(userId, adId),
            adId,
            createdBy: userId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }
    async deleteAd(orgId, userId, adId) {
        await this.ddb.delete(tables_1.Tables.ADS, { orgId, sk: (0, keys_1.sk)(userId, adId) });
    }
    async updateAd(orgId, userId, adId, updates) {
        const sets = ['#updatedAt = :updatedAt'];
        const names = { '#updatedAt': 'updatedAt' };
        const values = { ':updatedAt': new Date().toISOString() };
        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }
        await this.ddb.update(tables_1.Tables.ADS, { orgId, sk: (0, keys_1.sk)(userId, adId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
}
exports.AdRepo = AdRepo;
//# sourceMappingURL=repo.js.map