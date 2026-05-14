"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationRepo = void 0;
const tables_1 = require("../tables");
class ConversationRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getConversation(userId, conversationId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.CONVERSATIONS, { userId, conversationId });
        return Item ?? null;
    }
    async listConversations(userId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.CONVERSATIONS,
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: { ':userId': userId },
            ScanIndexForward: false,
        });
        return Items ?? [];
    }
    async createConversation(userId, conversationId, data) {
        const now = new Date().toISOString();
        await this.ddb.put(tables_1.Tables.CONVERSATIONS, {
            userId,
            conversationId,
            messageCount: 0,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }
    async deleteConversation(userId, conversationId) {
        await this.ddb.delete(tables_1.Tables.CONVERSATIONS, { userId, conversationId });
    }
    async updateConversation(userId, conversationId, updates) {
        const sets = ['#updatedAt = :updatedAt'];
        const names = { '#updatedAt': 'updatedAt' };
        const values = { ':updatedAt': new Date().toISOString() };
        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }
        await this.ddb.update(tables_1.Tables.CONVERSATIONS, { userId, conversationId }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
}
exports.ConversationRepo = ConversationRepo;
//# sourceMappingURL=repo.js.map