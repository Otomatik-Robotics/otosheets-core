import { z } from 'zod';

export const ConversationStoredSchema = z.object({
    userId: z.string(),
    conversationId: z.string(),
    organizationId: z.string().nullish(),
    title: z.string(),
    messages: z.any().nullish(),
    messageCount: z.number().default(0),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Conversation = z.infer<typeof ConversationStoredSchema>;

export const ConversationCreateRequestSchema = z.object({
    title: z.string(),
    organizationId: z.string().nullish(),
});
export type ConversationCreateRequest = z.infer<typeof ConversationCreateRequestSchema>;
