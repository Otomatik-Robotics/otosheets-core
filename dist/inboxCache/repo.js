"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InboxCacheRepo = void 0;
const tables_1 = require("../tables");
class InboxCacheRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getEntry(userId, gmailId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.INBOX_CACHE, { userId, gmailId });
        return Item ?? null;
    }
    async listByUser(userId, opts) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.INBOX_CACHE,
            KeyConditionExpression: 'userId = :uid',
            ExpressionAttributeValues: { ':uid': userId },
            ScanIndexForward: false,
            Limit: opts?.limit ?? 100,
        });
        return Items ?? [];
    }
    async putEntry(data) {
        await this.ddb.put(tables_1.Tables.INBOX_CACHE, data);
    }
    async deleteEntry(userId, gmailId) {
        await this.ddb.delete(tables_1.Tables.INBOX_CACHE, { userId, gmailId });
    }
}
exports.InboxCacheRepo = InboxCacheRepo;
//# sourceMappingURL=repo.js.map