import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { Notification } from './schema';

export class NotificationRepo {
    constructor(private ddb: IDdb) {}

    async getNotification(userId: string, notificationId: string): Promise<Notification | null> {
        const { Item } = await this.ddb.getItem(Tables.NOTIFICATIONS, { userId, notificationId });
        return (Item as Notification) ?? null;
    }

    async listNotifications(userId: string, opts?: { limit?: number }): Promise<Notification[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.NOTIFICATIONS,
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: { ':userId': userId },
            ScanIndexForward: false,
            Limit: opts?.limit ?? 50,
        });
        return (Items as Notification[]) ?? [];
    }

    async createNotification(userId: string, notificationId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        const ttl = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60; // 90 days
        await this.ddb.put(Tables.NOTIFICATIONS, {
            userId,
            notificationId,
            read: false,
            ...data,
            ttl,
            createdAt: now,
        });
    }

    async markRead(userId: string, notificationId: string): Promise<void> {
        await this.ddb.update(Tables.NOTIFICATIONS, { userId, notificationId }, {
            UpdateExpression: 'SET #read = :t',
            ExpressionAttributeNames: { '#read': 'read' },
            ExpressionAttributeValues: { ':t': true },
        });
    }

    async deleteNotification(userId: string, notificationId: string): Promise<void> {
        await this.ddb.delete(Tables.NOTIFICATIONS, { userId, notificationId });
    }
}
