"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatementRepo = void 0;
const tables_1 = require("../tables");
const keys_1 = require("../keys");
class StatementRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getStatement(userId, fy, statementId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.STATEMENTS, { userId, sk: (0, keys_1.statementSk)(fy, statementId) });
        return Item ?? null;
    }
    async listStatements(userId, fy) {
        const params = {
            TableName: tables_1.Tables.STATEMENTS,
            KeyConditionExpression: fy
                ? 'userId = :userId AND begins_with(sk, :fy)'
                : 'userId = :userId',
            ExpressionAttributeValues: { ':userId': userId, ...(fy ? { ':fy': fy } : {}) },
        };
        const { Items } = await this.ddb.query(params);
        return Items ?? [];
    }
    async createStatement(userId, statementId, data) {
        await this.ddb.put(tables_1.Tables.STATEMENTS, {
            userId,
            sk: (0, keys_1.statementSk)(data.fy, statementId),
            statementId,
            ...data,
            createdAt: new Date().toISOString(),
        });
    }
    async deleteStatement(userId, fy, statementId) {
        await this.ddb.delete(tables_1.Tables.STATEMENTS, { userId, sk: (0, keys_1.statementSk)(fy, statementId) });
    }
}
exports.StatementRepo = StatementRepo;
//# sourceMappingURL=repo.js.map