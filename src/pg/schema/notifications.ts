import { pgTable, text, jsonb, bigint, boolean, primaryKey, index } from 'drizzle-orm/pg-core';
import type { Notification } from '../../notification/schema';

// Preserve sparse legacy attributes without assigning unknown profile ownership.
export const notifications = pgTable('notifications', {
    userId: text('user_id').notNull(),
    notificationId: text('notification_id').notNull(),
    record: jsonb('record').$type<Notification>().notNull(),
    read: boolean('read'),
    ttl: bigint('ttl', { mode: 'number' }),
}, t => [primaryKey({ columns: [t.userId, t.notificationId] }), index('notifications_expiry_idx').on(t.ttl)]);
