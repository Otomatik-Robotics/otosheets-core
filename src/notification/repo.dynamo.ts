import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { Notification } from './schema';
import { INotificationRepo, NotificationListOptions, NotificationPage, notificationCursor, notificationKey, notificationLimit, notificationRecord, notificationToken } from './contract';

export class NotificationDynamoRepo implements INotificationRepo {
    constructor(private ddb: IDdb) {}

    async getNotification(userId: string, notificationId: string): Promise<Notification | null> {
        notificationKey(userId, notificationId);
        const { Item } = await this.ddb.getItem(Tables.NOTIFICATIONS, { userId, notificationId });
        return Item && (Item.ttl == null || Item.ttl > Math.floor(Date.now() / 1000)) ? Item as Notification : null;
    }

    async listNotifications(userId: string, opts?: { limit?: number }): Promise<Notification[]> {
        return (await this.listNotificationsPage(userId, opts)).items;
    }

    async listNotificationsPage(userId: string, opts: NotificationListOptions = {}): Promise<NotificationPage> {
        const after = notificationCursor(userId, opts.nextToken);
        const { Items, LastEvaluatedKey } = await this.ddb.query({
            TableName: Tables.NOTIFICATIONS,
            KeyConditionExpression: 'userId = :userId',
            FilterExpression: 'attribute_not_exists(#ttl) OR #ttl = :null OR #ttl > :now',
            ExpressionAttributeNames: { '#ttl': 'ttl' },
            ExpressionAttributeValues: { ':userId': userId, ':null': null, ':now': Math.floor(Date.now() / 1000) },
            ScanIndexForward: false,
            Limit: notificationLimit(opts.limit),
            ...(after ? { ExclusiveStartKey: { userId, notificationId: after } } : {}),
        });
        return { items: (Items as Notification[]) ?? [],
            ...(LastEvaluatedKey ? { nextToken: notificationToken(userId, LastEvaluatedKey.notificationId) } : {}) };
    }

    async createNotification(userId: string, notificationId: string, data: Record<string, any>): Promise<void> {
        await this.createNotificationOnce(userId, notificationId, data);
    }

    async createNotificationOnce(userId: string, notificationId: string, data: Record<string, any>): Promise<void> {
        try {
            await this.ddb.transactWrite([{ Put: { TableName: Tables.NOTIFICATIONS, Item: notificationRecord(userId, notificationId, data), ConditionExpression: 'attribute_not_exists(notificationId)' } }]);
        } catch (error) {
            const failure = error as { name?: string; CancellationReasons?: Array<{ Code?: string }> };
            if (failure.name !== 'TransactionCanceledException' || failure.CancellationReasons?.[0]?.Code !== 'ConditionalCheckFailed') throw error;
        }
    }

    async markRead(userId: string, notificationId: string): Promise<void> {
        notificationKey(userId, notificationId);
        try { await this.ddb.update(Tables.NOTIFICATIONS, { userId, notificationId }, {
            ConditionExpression: 'attribute_exists(notificationId)',
            UpdateExpression: 'SET #read = :t',
            ExpressionAttributeNames: { '#read': 'read' },
            ExpressionAttributeValues: { ':t': true },
        }); } catch (error) {
            if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
        }
    }

    async deleteNotification(userId: string, notificationId: string): Promise<void> {
        notificationKey(userId, notificationId);
        await this.ddb.delete(Tables.NOTIFICATIONS, { userId, notificationId });
    }
}
