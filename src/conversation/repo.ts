import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { Conversation } from './schema';

export interface ConversationTurn {
    mid: string;
    role: 'user' | 'assistant';
    content: string;
    at: string;
    by?: string;
}

export interface AppendConversationTurnInput {
    organizationId: string;
    leadId: string;
    title: string;
    source: string;
    turn: ConversationTurn;
    /** Additional thread attributes, written only when this turn is new. */
    attrs?: Record<string, unknown>;
}

const reservedTurnAttrs = new Set([
    'userId', 'conversationId', 'organizationId', 'leadId', 'title', 'source',
    'messages', 'messageIds', 'messageCount', 'createdAt', 'updatedAt',
]);
const maxAppendAttempts = 8;

export class ConversationRepo {
    constructor(private ddb: IDdb) {}

    /**
     * Atomically append a desk turn and its idempotency key. Historical threads
     * acquire their ID index under a messages-preimage condition, so a concurrent
     * append (even within the same updatedAt millisecond) cannot lose a turn.
     * An existing mid is a complete no-op, including extra email attributes.
     */
    async appendConversationTurn(userId: string, conversationId: string, input: AppendConversationTurnInput): Promise<{ appended: boolean }> {
        if (![userId, conversationId, input.organizationId, input.leadId, input.turn.mid].every(value => typeof value === 'string' && value.trim())) {
            throw new Error('Conversation turn identity is required');
        }
        const attrs = Object.entries(input.attrs ?? {}).filter(([, value]) => value !== undefined);
        if (attrs.some(([name]) => reservedTurnAttrs.has(name))) throw new Error('Conversation turn attrs cannot replace protected fields');

        const key = { userId, conversationId };
        for (let attempt = 0; attempt < maxAppendAttempts; attempt++) {
            const { Item: existing } = await this.ddb.getItem(Tables.CONVERSATIONS, key, { ConsistentRead: true });
            if (existing && existing.organizationId !== input.organizationId) throw new Error('Conversation does not belong to this organisation');
            if (existing?.leadId != null && existing.leadId !== input.leadId) throw new Error('Conversation does not belong to this lead');
            if (existing?.messages != null && !Array.isArray(existing.messages)) throw new Error('Conversation messages must be a list');
            const messages: Array<Record<string, unknown>> = existing?.messages ?? [];
            const indexed = existing?.messageIds instanceof Set;
            if (messages.some(message => message?.mid === input.turn.mid) || (indexed && existing.messageIds.has(input.turn.mid))) {
                return { appended: false };
            }

            const now = new Date().toISOString();
            const names: Record<string, string> = {
                '#messages': 'messages', '#messageIds': 'messageIds', '#messageCount': 'messageCount',
                '#org': 'organizationId', '#lead': 'leadId', '#updatedAt': 'updatedAt',
            };
            const values: Record<string, unknown> = {
                ':turns': [input.turn], ':org': input.organizationId, ':lead': input.leadId, ':now': now,
            };
            const sets = ['#updatedAt = :now', '#lead = :lead'];
            let condition: string;
            let add = '';
            if (!existing) {
                names['#userId'] = 'userId'; names['#conversationId'] = 'conversationId';
                names['#title'] = 'title'; names['#source'] = 'source'; names['#createdAt'] = 'createdAt';
                values[':title'] = input.title; values[':source'] = input.source;
                values[':count'] = 1; values[':ids'] = new Set([input.turn.mid]);
                sets.push('#messages = :turns', '#messageIds = :ids', '#messageCount = :count',
                    '#org = :org', '#title = :title', '#source = :source', '#createdAt = :now');
                condition = 'attribute_not_exists(#userId) AND attribute_not_exists(#conversationId)';
            } else {
                values[':null'] = null;
                condition = '#org = :org AND (attribute_not_exists(#lead) OR #lead = :null OR #lead = :lead)';
                if (indexed) {
                    // list_append and ADD operate on the live row, never the read copy.
                    values[':mid'] = input.turn.mid; values[':ids'] = new Set([input.turn.mid]); values[':one'] = 1;
                    sets.push('#messages = list_append(#messages, :turns)', '#messageCount = #messageCount + :one');
                    condition += ' AND attribute_exists(#messageIds) AND NOT contains(#messageIds, :mid)';
                    add = ' ADD #messageIds :ids';
                } else {
                    values[':ids'] = new Set([...messages.map(message => message?.mid).filter((mid): mid is string => typeof mid === 'string' && mid.length > 0), input.turn.mid]);
                    values[':count'] = messages.length + 1;
                    sets.push('#messageIds = :ids', '#messageCount = :count');
                    condition += ' AND attribute_not_exists(#messageIds)';
                    if (existing.messages === undefined) {
                        sets.push('#messages = :turns');
                        condition += ' AND attribute_not_exists(#messages)';
                    } else {
                        values[':previousMessages'] = existing.messages;
                        sets.push(existing.messages === null ? '#messages = :turns' : '#messages = list_append(#messages, :turns)');
                        condition += ' AND #messages = :previousMessages';
                    }
                }
            }
            attrs.forEach(([name, value], index) => {
                names[`#attr${index}`] = name; values[`:attr${index}`] = value;
                sets.push(`#attr${index} = :attr${index}`);
            });
            try {
                await this.ddb.update(Tables.CONVERSATIONS, key, {
                    UpdateExpression: `SET ${sets.join(', ')}${add}`,
                    ConditionExpression: condition,
                    ExpressionAttributeNames: names,
                    ExpressionAttributeValues: values,
                });
                return { appended: true };
            } catch (error) {
                if ((error as { name?: string })?.name !== 'ConditionalCheckFailedException') throw error;
            }
        }
        throw new Error('Conversation changed repeatedly while appending; retry the same turn');
    }

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

    async listConversationsPage(userId: string, scope: { organizationId: string; limit?: number; nextToken?: string }): Promise<{ items: Conversation[]; nextToken?: string }> {
        if (!scope.organizationId) throw new Error('Conversation scope is required');
        let key: Record<string, any> | undefined;
        if (scope.nextToken) {
            try {
                const token = JSON.parse(Buffer.from(scope.nextToken, 'base64url').toString());
                if (token.organizationId !== scope.organizationId || token.key?.userId !== userId || typeof token.key?.conversationId !== 'string') throw new Error();
                key = token.key;
            } catch { throw new Error('Invalid conversation nextToken'); }
        }
        const limit = scope.limit ?? 20;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid conversation limit');
        const page = await this.ddb.query({
            TableName: Tables.CONVERSATIONS,
            KeyConditionExpression: 'userId = :userId',
            FilterExpression: 'organizationId = :orgId AND (attribute_not_exists(#source) OR (NOT begins_with(#source, :meta) AND #source <> :visitor))',
            ExpressionAttributeNames: { '#source': 'source', '#title': 'title' },
            ExpressionAttributeValues: { ':userId': userId, ':orgId': scope.organizationId, ':meta': 'meta_', ':visitor': 'website_agent' },
            ProjectionExpression: 'conversationId, #title, messageCount, createdAt, updatedAt, organizationId',
            ScanIndexForward: false, Limit: limit, ExclusiveStartKey: key,
        });
        return { items: (page.Items ?? []) as Conversation[], ...(page.LastEvaluatedKey ? { nextToken: Buffer.from(JSON.stringify({ organizationId: scope.organizationId, key: page.LastEvaluatedKey })).toString('base64url') } : {}) };
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
