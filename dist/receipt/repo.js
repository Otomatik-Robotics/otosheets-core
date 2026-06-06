"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReceiptRepo = void 0;
const tables_1 = require("../tables");
const keys_1 = require("../keys");
class ReceiptRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getReceipt(orgId, userId, receiptId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.RECEIPTS, { orgId, sk: (0, keys_1.sk)(userId, receiptId) });
        return Item ?? null;
    }
    async findReceiptByIdInOrg(orgId, receiptId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.RECEIPTS,
            IndexName: 'ReceiptIdIndex',
            KeyConditionExpression: 'orgId = :orgId AND receiptId = :receiptId',
            ExpressionAttributeValues: { ':orgId': orgId, ':receiptId': receiptId },
            Limit: 1,
        });
        const item = Items?.[0];
        if (!item)
            return null;
        return { receipt: item, ownerId: item.createdBy };
    }
    async listAllOrgReceipts(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.RECEIPTS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return Items ?? [];
    }
    async listUserReceipts(orgId, userId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.RECEIPTS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `${userId}#` },
        });
        return Items ?? [];
    }
    async listReceiptsByDate(orgId, from, to, projection) {
        const params = {
            TableName: tables_1.Tables.RECEIPTS,
            IndexName: 'DateIndex',
            KeyConditionExpression: 'orgId = :orgId AND dateSk BETWEEN :from AND :to',
            ExpressionAttributeValues: { ':orgId': orgId, ':from': from, ':to': `${to}￿` },
        };
        if (projection) {
            params.ProjectionExpression = projection;
        }
        const { Items } = await this.ddb.query(params);
        return Items ?? [];
    }
    async createReceipt(orgId, userId, receiptId, data) {
        const now = new Date().toISOString();
        await this.ddb.put(tables_1.Tables.RECEIPTS, {
            orgId,
            sk: (0, keys_1.sk)(userId, receiptId),
            receiptId,
            createdBy: userId,
            ...data,
            dateSk: data.date ? (0, keys_1.dateSk)(data.date, receiptId) : undefined,
            createdAt: now,
        });
    }
    async updateReceipt(orgId, userId, receiptId, updates) {
        const sets = [];
        const names = {};
        const values = {};
        if (updates.date) {
            updates.dateSk = (0, keys_1.dateSk)(updates.date, receiptId);
        }
        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }
        await this.ddb.update(tables_1.Tables.RECEIPTS, { orgId, sk: (0, keys_1.sk)(userId, receiptId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
    async deleteReceipt(orgId, userId, receiptId) {
        await this.ddb.delete(tables_1.Tables.RECEIPTS, { orgId, sk: (0, keys_1.sk)(userId, receiptId) });
    }
}
exports.ReceiptRepo = ReceiptRepo;
//# sourceMappingURL=repo.js.map