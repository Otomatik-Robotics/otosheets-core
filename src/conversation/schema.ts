import { z } from 'zod';

export const ConversationBaseSchema = z.object({
    conversationId: z.string(),
    title: z.string(),
    messages: z.any().nullish(),
    messageCount: z.number().default(0),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type ConversationBase = z.infer<typeof ConversationBaseSchema>;

export const ConversationStoredSchema = ConversationBaseSchema.extend({
    userId: z.string(),
    organizationId: z.string().nullish(),
});
export type Conversation = z.infer<typeof ConversationStoredSchema>;

export const ConversationCreateRequestSchema = z.object({
    title: z.string(),
    organizationId: z.string().nullish(),
});
export type ConversationCreateRequest = z.infer<typeof ConversationCreateRequestSchema>;
