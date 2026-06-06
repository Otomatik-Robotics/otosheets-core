import { IDdb } from '../ddbPort';
import { Conversation } from './schema';
export declare class ConversationRepo {
    private ddb;
    constructor(ddb: IDdb);
    getConversation(userId: string, conversationId: string): Promise<Conversation | null>;
    listConversations(userId: string): Promise<Conversation[]>;
    createConversation(userId: string, conversationId: string, data: Record<string, any>): Promise<void>;
    deleteConversation(userId: string, conversationId: string): Promise<void>;
    updateConversation(userId: string, conversationId: string, updates: Record<string, any>): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map