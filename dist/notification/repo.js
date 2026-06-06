"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationRepo = void 0;
const tables_1 = require("../tables");
class NotificationRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getNotification(userId, notificationId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.NOTIFICATIONS, { userId, notificationId });
        return Item ?? null;
    }
    async listNotifications(userId, opts) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.NOTIFICATIONS,
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: { ':userId': userId },
            ScanIndexForward: false,
            Limit: opts?.limit ?? 50,
        });
        return Items ?? [];
    }
    async createNotification(userId, notificationId, data) {
        const now = new Date().toISOString();
        const ttl = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60; // 90 days
        await this.ddb.put(tables_1.Tables.NOTIFICATIONS, {
            userId,
            notificationId,
            read: false,
            ...data,
            ttl,
            createdAt: now,
        });
    }
    async markRead(userId, notificationId) {
        await this.ddb.update(tables_1.Tables.NOTIFICATIONS, { userId, notificationId }, {
            UpdateExpression: 'SET #read = :t',
            ExpressionAttributeNames: { '#read': 'read' },
            ExpressionAttributeValues: { ':t': true },
        });
    }
    async deleteNotification(userId, notificationId) {
        await this.ddb.delete(tables_1.Tables.NOTIFICATIONS, { userId, notificationId });
    }
}
exports.NotificationRepo = NotificationRepo;
//# sourceMappingURL=repo.js.map