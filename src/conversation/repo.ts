import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { Conversation } from './schema';

export class ConversationRepo {
    constructor(private ddb: IDdb) {}

    async getConversation(userId: string, conversationId: string): Promise<Conversation | null> {
        const { Item } = await this.ddb.getItem(Tables.CONVERSATIONS, { userId, conversationId });
        return (Item as Conversation) ?? null;
    }

    async listConversations(userId: string): Promise<Conversation[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.CONVERSATIONS,
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: { ':userId': userId },
            ScanIndexForward: false,
        });
        return (Items as Conversation[]) ?? [];
    }

    async createConversation(userId: string, conversationId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.CONVERSATIONS, {
            userId,
            conversationId,
            messageCount: 0,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }

    async deleteConversation(userId: string, conversationId: string): Promise<void> {
        await this.ddb.delete(Tables.CONVERSATIONS, { userId, conversationId });
    }

    async updateConversation(userId: string, conversationId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = ['#updatedAt = :updatedAt'];
        const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
        const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };

        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }

        await this.ddb.update(Tables.CONVERSATIONS, { userId, conversationId }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
}
