import { IDdb } from '../ddbPort';
import { ChatMessage } from './schema';
export declare class ChatMessageRepo {
    private ddb;
    constructor(ddb: IDdb);
    getMessage(conversationId: string, messageId: string): Promise<ChatMessage | null>;
    listMessages(conversationId: string, opts?: {
        limit?: number;
    }): Promise<ChatMessage[]>;
    createMessage(data: ChatMessage): Promise<void>;
    updateStatus(conversationId: string, messageId: string, status: string): Promise<void>;
    deleteMessage(conversationId: string, messageId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map