"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrgRepo = void 0;
const tables_1 = require("../tables");
class OrgRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getOrg(orgId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.ORGANIZATIONS, { orgId });
        return Item ?? null;
    }
    async getOrgBySlug(slug) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.ORGANIZATIONS,
            IndexName: 'SlugIndex',
            KeyConditionExpression: 'slug = :slug',
            ExpressionAttributeValues: { ':slug': slug },
            Limit: 1,
        });
        return Items?.[0] ?? null;
    }
    async createOrg(orgId, data) {
        const now = new Date().toISOString();
        await this.ddb.put(tables_1.Tables.ORGANIZATIONS, {
            orgId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }
    async updateOrg(orgId, updates) {
        const sets = ['#updatedAt = :updatedAt'];
        const names = { '#updatedAt': 'updatedAt' };
        const values = { ':updatedAt': new Date().toISOString() };
        for (const [key, val] of Object.entries(updates)) {
            const attr = `#${key}`;
            const placeholder = `:${key}`;
            sets.push(`${attr} = ${placeholder}`);
            names[attr] = key;
            values[placeholder] = val;
        }
        await this.ddb.update(tables_1.Tables.ORGANIZATIONS, { orgId }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
}
exports.OrgRepo = OrgRepo;
//# sourceMappingURL=repo.js.map