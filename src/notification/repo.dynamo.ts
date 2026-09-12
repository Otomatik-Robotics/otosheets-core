import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { Notification } from './schema';
import { INotificationRepo, NotificationListOptions, NotificationPage, notificationCursor, notificationKey, notificationLimit, notificationRecord, notificationToken, notificationScope, notificationOwned, type NotificationScope } from './contract';

export class NotificationDynamoRepo implements INotificationRepo {
    constructor(private ddb: IDdb, private readonly scope?: NotificationScope) {}
    withScope(orgId: string, businessProfileId: string): NotificationDynamoRepo {
        return new NotificationDynamoRepo(this.ddb, notificationScope(orgId, businessProfileId, this.scope));
    }
    // Unstamped rows predate profile scoping and belong to the recipient; see notificationOwned.
    private scopeCondition() { return this.scope ? ' AND (attribute_not_exists(#org) OR #org = :null OR (#org = :org AND #profile = :profile))' : ''; }
    private scopeNames(): Record<string, string> { return this.scope ? { '#org': 'organizationId', '#profile': 'businessProfileId' } : {}; }
    private scopeValues(): Record<string, string | null> { return this.scope ? { ':org': this.scope.orgId, ':profile': this.scope.businessProfileId, ':null': null } : {}; }

    async getNotification(userId: string, notificationId: string): Promise<Notification | null> {
        notificationKey(userId, notificationId);
        const { Item } = await this.ddb.getItem(Tables.NOTIFICATIONS, { userId, notificationId });
        return Item && notificationOwned(Item, this.scope) && (Item.ttl == null || Item.ttl > Math.floor(Date.now() / 1000)) ? Item as Notification : null;
    }

    async listNotifications(userId: string, opts?: { limit?: number }): Promise<Notification[]> {
        const items: Notification[] = [];
        const limit = notificationLimit(opts?.limit);
        let nextToken: string | undefined;
        do {
            const page = await this.listNotificationsPage(userId, { limit: limit - items.length, nextToken });
            items.push(...page.items);
            nextToken = page.nextToken;
        } while (this.scope && nextToken && items.length < limit);
        return items;
    }

    async listNotificationsPage(userId: string, opts: NotificationListOptions = {}): Promise<NotificationPage> {
        const after = notificationCursor(userId, opts.nextToken, this.scope);
        const { Items, LastEvaluatedKey } = await this.ddb.query({
            TableName: Tables.NOTIFICATIONS,
            KeyConditionExpression: 'userId = :userId',
            FilterExpression: '(attribute_not_exists(#ttl) OR #ttl = :null OR #ttl > :now)' + this.scopeCondition(),
            ExpressionAttributeNames: { '#ttl': 'ttl', ...this.scopeNames() },
            ExpressionAttributeValues: { ':userId': userId, ':null': null, ':now': Math.floor(Date.now() / 1000), ...this.scopeValues() },
            ScanIndexForward: false,
            Limit: notificationLimit(opts.limit),
            ...(after ? { ExclusiveStartKey: { userId, notificationId: after } } : {}),
        });
        return { items: (Items as Notification[]) ?? [],
            ...(LastEvaluatedKey ? { nextToken: notificationToken(userId, LastEvaluatedKey.notificationId, this.scope) } : {}) };
    }

    async createNotification(userId: string, notificationId: string, data: Record<string, any>): Promise<void> {
        await this.createNotificationOnce(userId, notificationId, data);
    }

    async createNotificationOnce(userId: string, notificationId: string, data: Record<string, any>): Promise<void> {
        try {
            await this.ddb.transactWrite([{ Put: { TableName: Tables.NOTIFICATIONS, Item: notificationRecord(userId, notificationId, data, this.scope), ConditionExpression: 'attribute_not_exists(notificationId)' } }]);
        } catch (error) {
            const failure = error as { name?: string; CancellationReasons?: Array<{ Code?: string }> };
            if (failure.name !== 'TransactionCanceledException' || failure.CancellationReasons?.[0]?.Code !== 'ConditionalCheckFailed') throw error;
            if (this.scope) {
                const { Item } = await this.ddb.getItem(Tables.NOTIFICATIONS, { userId, notificationId }, { ConsistentRead: true });
                if (!Item || !notificationOwned(Item, this.scope)) throw new Error('Notification ownership mismatch');
            }
        }
    }

    async markRead(userId: string, notificationId: string): Promise<void> {
        notificationKey(userId, notificationId);
        try { await this.ddb.update(Tables.NOTIFICATIONS, { userId, notificationId }, {
            ConditionExpression: 'attribute_exists(notificationId)' + this.scopeCondition(),
            UpdateExpression: 'SET #read = :t',
            ExpressionAttributeNames: { '#read': 'read', ...this.scopeNames() },
            ExpressionAttributeValues: { ':t': true, ...this.scopeValues() },
        }); } catch (error) {
            if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
        }
    }

    async deleteNotification(userId: string, notificationId: string): Promise<void> {
        notificationKey(userId, notificationId);
        if (!this.scope) { await this.ddb.delete(Tables.NOTIFICATIONS, { userId, notificationId }); return; }
        try {
            await this.ddb.transactWrite([{ Delete: { TableName: Tables.NOTIFICATIONS, Key: { userId, notificationId },
                ConditionExpression: 'attribute_exists(notificationId)' + this.scopeCondition(),
                ExpressionAttributeNames: this.scopeNames(), ExpressionAttributeValues: this.scopeValues() } }]);
        } catch (error) {
            const failure = error as { name?: string; CancellationReasons?: Array<{ Code?: string }> };
            if (failure.name !== 'TransactionCanceledException' || failure.CancellationReasons?.[0]?.Code !== 'ConditionalCheckFailed') throw error;
        }
    }
}
