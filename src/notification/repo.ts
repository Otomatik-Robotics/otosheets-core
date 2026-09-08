import type { IDdb } from '../ddbPort';
import type { INotificationRepo, NotificationListOptions, NotificationPage } from './contract';
import { notificationScope, type NotificationScope } from './contract';
import type { Notification } from './schema';
import { NotificationDynamoRepo } from './repo.dynamo';
import { NotificationPgRepo } from './repo.pg';
import { notificationStorageMode } from './storage';

/** Defaults to Dynamo until the independently coordinated notification cutover. */
export class NotificationRepo implements INotificationRepo {
    private dynamo: NotificationDynamoRepo;
    private pg: NotificationPgRepo;
    constructor(private ddb: IDdb, private readonly scope?: NotificationScope) {
        this.dynamo = new NotificationDynamoRepo(ddb, scope);
        this.pg = new NotificationPgRepo(undefined, scope);
    }
    withScope(orgId: string, businessProfileId: string): NotificationRepo {
        return new NotificationRepo(this.ddb, notificationScope(orgId, businessProfileId, this.scope));
    }
    private async repo(): Promise<INotificationRepo> { return await notificationStorageMode() === 'pg' ? this.pg : this.dynamo; }
    async getNotification(userId: string, notificationId: string): Promise<Notification | null> {
        return (await this.repo()).getNotification(userId, notificationId);
    }
    async listNotifications(userId: string, opts?: { limit?: number }): Promise<Notification[]> {
        return (await this.repo()).listNotifications(userId, opts);
    }
    async listNotificationsPage(userId: string, opts?: NotificationListOptions): Promise<NotificationPage> {
        return (await this.repo()).listNotificationsPage(userId, opts);
    }
    async createNotification(userId: string, notificationId: string, data: Record<string, any>): Promise<void> {
        return (await this.repo()).createNotification(userId, notificationId, data);
    }
    async createNotificationOnce(userId: string, notificationId: string, data: Record<string, any>): Promise<void> {
        return (await this.repo()).createNotificationOnce(userId, notificationId, data);
    }
    async markRead(userId: string, notificationId: string): Promise<void> { return (await this.repo()).markRead(userId, notificationId); }
    async deleteNotification(userId: string, notificationId: string): Promise<void> { return (await this.repo()).deleteNotification(userId, notificationId); }
}
