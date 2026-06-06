"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatMessageRepo = void 0;
const tables_1 = require("../tables");
class ChatMessageRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getMessage(conversationId, messageId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.MESSAGES, { conversationId, messageId });
        return Item ?? null;
    }
    async listMessages(conversationId, opts) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.MESSAGES,
            KeyConditionExpression: 'conversationId = :cid',
            ExpressionAttributeValues: { ':cid': conversationId },
            ScanIndexForward: false,
            Limit: opts?.limit ?? 50,
        });
        return Items ?? [];
    }
    async createMessage(data) {
        await this.ddb.put(tables_1.Tables.MESSAGES, data);
    }
    async updateStatus(conversationId, messageId, status) {
        await this.ddb.update(tables_1.Tables.MESSAGES, { conversationId, messageId }, {
            UpdateExpression: 'SET #status = :s',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':s': status },
        });
    }
    async deleteMessage(conversationId, messageId) {
        await this.ddb.delete(tables_1.Tables.MESSAGES, { conversationId, messageId });
    }
}
exports.ChatMessageRepo = ChatMessageRepo;
//# sourceMappingURL=repo.js.map