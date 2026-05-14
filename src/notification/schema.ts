import { z } from 'zod';

export const NotificationStoredSchema = z.object({
    userId: z.string(),
    notificationId: z.string(),
    organizationId: z.string().nullish(),
    type: z.string(),
    title: z.string(),
    body: z.string(),
    read: z.boolean().default(false),
    link: z.string().nullish(),
    priority: z.string().nullish(),
    meta: z.any().nullish(),
    ttl: z.number().nullish(),
    createdAt: z.string(),
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
