import { z } from 'zod';
export declare const ConversationBaseSchema: z.ZodObject<{
    conversationId: z.ZodString;
    title: z.ZodString;
    messages: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
    messageCount: z.ZodDefault<z.ZodNumber>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    createdAt: string;
    updatedAt: string;
    title: string;
    conversationId: string;
    messageCount: number;
    messages?: any;
}, {
    createdAt: string;
    updatedAt: string;
    title: string;
    conversationId: string;
    messages?: any;
    messageCount?: number | undefined;
}>;
export type ConversationBase = z.infer<typeof ConversationBaseSchema>;
export declare const ConversationStoredSchema: z.ZodObject<{
    conversationId: z.ZodString;
    title: z.ZodString;
    messages: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
    messageCount: z.ZodDefault<z.ZodNumber>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
} & {
    userId: z.ZodString;
    organizationId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    userId: string;
    createdAt: string;
    updatedAt: string;
    title: string;
    conversationId: string;
    messageCount: number;
    organizationId?: string | null | undefined;
    messages?: any;
}, {
    userId: string;
    createdAt: string;
    updatedAt: string;
    title: string;
    conversationId: string;
    organizationId?: string | null | undefined;
    messages?: any;
    messageCount?: number | undefined;
}>;
export type Conversation = z.infer<typeof ConversationStoredSchema>;
export declare const ConversationCreateRequestSchema: z.ZodObject<{
    title: z.ZodString;
    organizationId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    title: string;
    organizationId?: string | null | undefined;
}, {
    title: string;
    organizationId?: string | null | undefined;
}>;
export type ConversationCreateRequest = z.infer<typeof ConversationCreateRequestSchema>;
//# sourceMappingURL=schema.d.ts.map