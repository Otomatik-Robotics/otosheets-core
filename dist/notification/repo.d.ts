import { IDdb } from '../ddbPort';
import { Notification } from './schema';
export declare class NotificationRepo {
    private ddb;
    constructor(ddb: IDdb);
    getNotification(userId: string, notificationId: string): Promise<Notification | null>;
    listNotifications(userId: string, opts?: {
        limit?: number;
    }): Promise<Notification[]>;
    createNotification(userId: string, notificationId: string, data: Record<string, any>): Promise<void>;
    markRead(userId: string, notificationId: string): Promise<void>;
    deleteNotification(userId: string, notificationId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map