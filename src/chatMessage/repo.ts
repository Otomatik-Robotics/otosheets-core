import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { ChatMessage } from './schema';

export class ChatMessageRepo {
    constructor(private ddb: IDdb) {}

    async getMessage(conversationId: string, messageId: string): Promise<ChatMessage | null> {
        const { Item } = await this.ddb.getItem(Tables.MESSAGES, { conversationId, messageId });
        return (Item as ChatMessage) ?? null;
    }

    async listMessages(conversationId: string, opts?: { limit?: number }): Promise<ChatMessage[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.MESSAGES,
            KeyConditionExpression: 'conversationId = :cid',
            ExpressionAttributeValues: { ':cid': conversationId },
            ScanIndexForward: false,
            Limit: opts?.limit ?? 50,
        });
        return (Items as ChatMessage[]) ?? [];
    }

    async createMessage(data: ChatMessage): Promise<void> {
        await this.ddb.put(Tables.MESSAGES, data);
    }

    async updateStatus(conversationId: string, messageId: string, status: string): Promise<void> {
        await this.ddb.update(Tables.MESSAGES, { conversationId, messageId }, {
            UpdateExpression: 'SET #status = :s',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':s': status },
        });
    }

    async deleteMessage(conversationId: string, messageId: string): Promise<void> {
        await this.ddb.delete(Tables.MESSAGES, { conversationId, messageId });
    }
}
