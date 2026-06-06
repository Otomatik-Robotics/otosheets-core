import { z } from 'zod';
export declare const NotificationBaseSchema: z.ZodObject<{
    notificationId: z.ZodString;
    type: z.ZodString;
    title: z.ZodString;
    body: z.ZodString;
    read: z.ZodDefault<z.ZodBoolean>;
    link: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    priority: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    meta: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: string;
    createdAt: string;
    title: string;
    notificationId: string;
    body: string;
    read: boolean;
    link?: string | null | undefined;
    priority?: string | null | undefined;
    meta?: any;
}, {
    type: string;
    createdAt: string;
    title: string;
    notificationId: string;
    body: string;
    read?: boolean | undefined;
    link?: string | null | undefined;
    priority?: string | null | undefined;
    meta?: any;
}>;
export type NotificationBase = z.infer<typeof NotificationBaseSchema>;
export declare const NotificationStoredSchema: z.ZodObject<{
    notificationId: z.ZodString;
    type: z.ZodString;
    title: z.ZodString;
    body: z.ZodString;
    read: z.ZodDefault<z.ZodBoolean>;
    link: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    priority: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    meta: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
    createdAt: z.ZodString;
} & {
    userId: z.ZodString;
    organizationId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    ttl: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    userId: string;
    type: string;
    createdAt: string;
    title: string;
    notificationId: string;
    body: string;
    read: boolean;
    organizationId?: string | null | undefined;
    link?: string | null | undefined;
    priority?: string | null | undefined;
    meta?: any;
    ttl?: number | null | undefined;
}, {
    userId: string;
    type: string;
    createdAt: string;
    title: string;
    notificationId: string;
    body: string;
    organizationId?: string | null | undefined;
    read?: boolean | undefined;
    link?: string | null | undefined;
    priority?: string | null | undefined;
    meta?: any;
    ttl?: number | null | undefined;
}>;
export type Notification = z.infer<typeof NotificationStoredSchema>;
export declare const NotificationCreateRequestSchema: z.ZodObject<{
    type: z.ZodString;
    title: z.ZodString;
    body: z.ZodString;
    link: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    priority: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    meta: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
    organizationId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    type: string;
    title: string;
    body: string;
    organizationId?: string | null | undefined;
    link?: string | null | undefined;
    priority?: string | null | undefined;
    meta?: any;
}, {
    type: string;
    title: string;
    body: string;
    organizationId?: string | null | undefined;
    link?: string | null | undefined;
    priority?: string | null | undefined;
    meta?: any;
}>;
export type NotificationCreateRequest = z.infer<typeof NotificationCreateRequestSchema>;
//# sourceMappingURL=schema.d.ts.map