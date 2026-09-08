import type { Notification } from './schema';

export interface NotificationListOptions { limit?: number; nextToken?: string; }
export interface NotificationPage { items: Notification[]; nextToken?: string; }
export interface INotificationRepo {
    getNotification(userId: string, notificationId: string): Promise<Notification | null>;
    listNotifications(userId: string, opts?: { limit?: number }): Promise<Notification[]>;
    listNotificationsPage(userId: string, opts?: NotificationListOptions): Promise<NotificationPage>;
    createNotification(userId: string, notificationId: string, data: Record<string, any>): Promise<void>;
    createNotificationOnce(userId: string, notificationId: string, data: Record<string, any>): Promise<void>;
    markRead(userId: string, notificationId: string): Promise<void>;
    deleteNotification(userId: string, notificationId: string): Promise<void>;
}

export function notificationLimit(limit = 50): number {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Notification limit must be between 1 and 200');
    return limit;
}
export function notificationKey(userId: string, notificationId: string): void {
    if (!userId || !notificationId) throw new Error('Notification recipient and ID are required');
}
export function notificationToken(userId: string, notificationId: string): string {
    return Buffer.from(JSON.stringify({ userId, notificationId })).toString('base64url');
}
export function notificationCursor(userId: string, token?: string): string | undefined {
    if (!userId) throw new Error('Notification recipient is required');
    if (token === undefined) return undefined;
    try {
        const value = JSON.parse(Buffer.from(token, 'base64url').toString());
        if (value.userId !== userId || typeof value.notificationId !== 'string' || !value.notificationId || notificationToken(userId, value.notificationId) !== token) throw new Error();
        return value.notificationId;
    } catch { throw new Error('Invalid notification nextToken'); }
}
export function notificationRecord(userId: string, notificationId: string, data: Record<string, any>): Notification {
    notificationKey(userId, notificationId);
    return { ...data, userId, notificationId, read: false,
        ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
        createdAt: new Date().toISOString() } as Notification;
}
