import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { notifications } from '../pg/schema/notifications';
import type { Notification } from './schema';
import { INotificationRepo, NotificationListOptions, NotificationPage, notificationCursor, notificationKey, notificationLimit, notificationRecord, notificationToken } from './contract';

export class NotificationPgRepo implements INotificationRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }
    private active() { return or(isNull(notifications.ttl), gt(notifications.ttl, Math.floor(Date.now() / 1000))); }
    private record(row: typeof notifications.$inferSelect): Notification {
        return { ...row.record, userId: row.userId, notificationId: row.notificationId,
            ...(row.read === null ? {} : { read: row.read }) };
    }
    async getNotification(userId: string, notificationId: string): Promise<Notification | null> {
        notificationKey(userId, notificationId);
        const [row] = await this.db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.notificationId, notificationId), this.active()));
        return row ? this.record(row) : null;
    }
    async listNotifications(userId: string, opts?: { limit?: number }): Promise<Notification[]> {
        return (await this.listNotificationsPage(userId, opts)).items;
    }
    async listNotificationsPage(userId: string, opts: NotificationListOptions = {}): Promise<NotificationPage> {
        const after = notificationCursor(userId, opts.nextToken), limit = notificationLimit(opts.limit);
        const rows = await this.db.select().from(notifications).where(and(eq(notifications.userId, userId), this.active(), after ? lt(notifications.notificationId, after) : undefined))
            .orderBy(desc(notifications.notificationId)).limit(limit + 1);
        const items = rows.slice(0, limit).map(row => this.record(row));
        return { items, ...(rows.length > limit ? { nextToken: notificationToken(userId, items[items.length - 1].notificationId) } : {}) };
    }
    async createNotification(userId: string, notificationId: string, data: Record<string, any>): Promise<void> {
        await this.createNotificationOnce(userId, notificationId, data);
    }
    async createNotificationOnce(userId: string, notificationId: string, data: Record<string, any>): Promise<void> {
        await this.importNotification(notificationRecord(userId, notificationId, data));
    }
    /** Insert-only backfill: preserves source attributes and never overwrites newer target state. */
    async importNotification(record: Notification): Promise<void> {
        notificationKey(record.userId, record.notificationId);
        if (record.ttl != null && (!Number.isSafeInteger(record.ttl) || record.ttl < 0)) throw new Error('Invalid notification expiry');
        await this.db.insert(notifications).values({ userId: record.userId, notificationId: record.notificationId, record, read: record.read ?? null, ttl: record.ttl ?? null }).onConflictDoNothing();
    }
    async markRead(userId: string, notificationId: string): Promise<void> {
        notificationKey(userId, notificationId);
        await this.db.update(notifications).set({ read: true }).where(and(eq(notifications.userId, userId), eq(notifications.notificationId, notificationId), this.active()));
    }
    async deleteNotification(userId: string, notificationId: string): Promise<void> {
        notificationKey(userId, notificationId);
        await this.db.delete(notifications).where(and(eq(notifications.userId, userId), eq(notifications.notificationId, notificationId)));
    }
    /** Maintenance primitive; schedule only after retention/cutover review. Reads enforce expiry independently. */
    async deleteExpired(limit = 200): Promise<number> {
        notificationLimit(limit);
        const result = await this.db.execute(sql`WITH expired AS (
            SELECT user_id, notification_id FROM notifications WHERE ttl <= ${Math.floor(Date.now() / 1000)}
            ORDER BY ttl, user_id, notification_id LIMIT ${limit} FOR UPDATE SKIP LOCKED
        ) DELETE FROM notifications n USING expired e
          WHERE n.user_id = e.user_id AND n.notification_id = e.notification_id RETURNING n.notification_id`);
        return result.rows.length;
    }
}
