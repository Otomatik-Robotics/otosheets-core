import type { Notification } from './schema';

export interface NotificationScope { readonly orgId: string; readonly businessProfileId: string; }
export function notificationScope(orgId: string, businessProfileId: string, current?: NotificationScope): NotificationScope {
    if (!orgId.trim() || !businessProfileId.trim()) throw new Error('Notification scope is required');
    if (current && (current.orgId !== orgId || current.businessProfileId !== businessProfileId)) throw new Error('Notification scope mismatch');
    return Object.freeze({ orgId, businessProfileId });
}
/**
 * A row written before business-profile scoping carries no organizationId at
 * all. It is still the recipient's own row (the partition key is the user), so
 * it stays readable and markable in any of that user's scopes rather than
 * vanishing from every inbox. A stamped row must match the scope exactly.
 */
export function notificationLegacy(record: Record<string, any>): boolean {
    return record.organizationId === undefined || record.organizationId === null;
}
export function notificationOwned(record: Record<string, any>, scope?: NotificationScope): boolean {
    return !scope || notificationLegacy(record) || (record.organizationId === scope.orgId && record.businessProfileId === scope.businessProfileId);
}

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
export function notificationToken(userId: string, notificationId: string, scope?: NotificationScope): string {
    return Buffer.from(JSON.stringify({ userId, notificationId, ...(scope ? { orgId: scope.orgId, businessProfileId: scope.businessProfileId } : {}) })).toString('base64url');
}
export function notificationCursor(userId: string, token?: string, scope?: NotificationScope): string | undefined {
    if (!userId) throw new Error('Notification recipient is required');
    if (token === undefined) return undefined;
    try {
        const value = JSON.parse(Buffer.from(token, 'base64url').toString());
        if (value.userId !== userId || typeof value.notificationId !== 'string' || !value.notificationId || notificationToken(userId, value.notificationId, scope) !== token) throw new Error();
        return value.notificationId;
    } catch { throw new Error('Invalid notification nextToken'); }
}
export function notificationRecord(userId: string, notificationId: string, data: Record<string, any>, scope?: NotificationScope): Notification {
    notificationKey(userId, notificationId);
    if (scope && ((data.organizationId != null && data.organizationId !== scope.orgId)
        || (data.businessProfileId != null && data.businessProfileId !== scope.businessProfileId))) throw new Error('Notification ownership mismatch');
    return { ...data, ...(scope ? { organizationId: scope.orgId, businessProfileId: scope.businessProfileId } : {}), userId, notificationId, read: false,
        ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
        createdAt: new Date().toISOString() } as Notification;
}
