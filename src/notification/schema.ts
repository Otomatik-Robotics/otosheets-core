import { z } from 'zod';

export const NotificationBaseSchema = z.object({
    notificationId: z.string(),
    type: z.string(),
    title: z.string(),
    body: z.string(),
    read: z.boolean().default(false),
    link: z.string().nullish(),
    priority: z.string().nullish(),
    meta: z.any().nullish(),
    createdAt: z.string(),
});
export type NotificationBase = z.infer<typeof NotificationBaseSchema>;

export const NotificationStoredSchema = NotificationBaseSchema.extend({
    userId: z.string(),
    organizationId: z.string().nullish(),
    ttl: z.number().nullish(),
});
export type Notification = z.infer<typeof NotificationStoredSchema>;

export const NotificationCreateRequestSchema = z.object({
    type: z.string(),
    title: z.string(),
    body: z.string(),
    link: z.string().nullish(),
    priority: z.string().nullish(),
    meta: z.any().nullish(),
    organizationId: z.string().nullish(),
});
export type NotificationCreateRequest = z.infer<typeof NotificationCreateRequestSchema>;
