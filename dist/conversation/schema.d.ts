import { z } from 'zod';
export declare const ConversationStoredSchema: z.ZodObject<{
    userId: z.ZodString;
    conversationId: z.ZodString;
    organizationId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    title: z.ZodString;
    messages: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
    messageCount: z.ZodDefault<z.ZodNumber>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
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