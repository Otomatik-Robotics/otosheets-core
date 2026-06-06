"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RotationRepo = void 0;
const tables_1 = require("../tables");
const keys_1 = require("../keys");
class RotationRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async get(orgId, rotationId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.SCHEDULING, { orgId, sk: (0, keys_1.rotationSk)(rotationId) });
        return Item ?? null;
    }
    async listByOrg(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.SCHEDULING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'ROTATION#' },
        });
        return Items ?? [];
    }
    async create(orgId, rotationId, data) {
        const now = new Date().toISOString();
        await this.ddb.put(tables_1.Tables.SCHEDULING, {
            orgId,
            sk: (0, keys_1.rotationSk)(rotationId),
            rotationId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }
    async update(orgId, rotationId, updates) {
        const sets = ['#updatedAt = :updatedAt'];
        const names = { '#updatedAt': 'updatedAt' };
        const values = { ':updatedAt': new Date().toISOString() };
        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }
        await this.ddb.update(tables_1.Tables.SCHEDULING, { orgId, sk: (0, keys_1.rotationSk)(rotationId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
    async delete(orgId, rotationId) {
        await this.ddb.delete(tables_1.Tables.SCHEDULING, { orgId, sk: (0, keys_1.rotationSk)(rotationId) });
    }
}
exports.RotationRepo = RotationRepo;
//# sourceMappingURL=repo.js.map