"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShareTokenRepo = void 0;
const tables_1 = require("../tables");
class ShareTokenRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getToken(token) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.SHARE_TOKENS, { token });
        return Item ?? null;
    }
    async listByUser(userId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.SHARE_TOKENS,
            IndexName: 'UserIndex',
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: { ':userId': userId },
        });
        return Items ?? [];
    }
    async createToken(data) {
        await this.ddb.put(tables_1.Tables.SHARE_TOKENS, data);
    }
    async incrementAccessCount(token) {
        await this.ddb.update(tables_1.Tables.SHARE_TOKENS, { token }, {
            UpdateExpression: 'SET accessCount = accessCount + :one',
            ExpressionAttributeValues: { ':one': 1 },
        });
    }
    async deleteToken(token) {
        await this.ddb.delete(tables_1.Tables.SHARE_TOKENS, { token });
    }
}
exports.ShareTokenRepo = ShareTokenRepo;
//# sourceMappingURL=repo.js.map