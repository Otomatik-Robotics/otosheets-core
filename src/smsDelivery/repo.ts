import { createHash } from 'node:crypto';
import type { IDdb } from '../ddbPort';

export interface SmsDelivery extends Record<string, unknown> {
    orgId: string; actorUserId: string; requestId: string; fingerprint: string;
    conversationId: string; messageId: string; status: 'STARTED' | 'ACCEPTED' | 'FAILED' | 'NEEDS_REVIEW';
    providerMessageId?: string; error?: string;
}
const table = () => { if (!process.env.MESSAGES_TABLE) throw new Error('MESSAGES_TABLE is required'); return process.env.MESSAGES_TABLE; };
function key(orgId: string, actorUserId: string, requestId: string) {
    if (!orgId || !actorUserId || !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) throw new Error('Invalid SMS request identity');
    return { conversationId: `SMSREQUEST#${orgId}`, messageId: createHash('sha256').update(JSON.stringify([actorUserId, requestId])).digest('hex') };
}
const isConflict = (error: unknown) => {
    const e = error as { name?: string; CancellationReasons?: Array<{ Code?: string }> };
    return e.name === 'ConditionalCheckFailedException' || (e.name === 'TransactionCanceledException' && e.CancellationReasons?.some(reason => reason.Code === 'ConditionalCheckFailed'));
};

/** Durable request claim prevents a repeated HTTP request from sending another SMS. */
export class SmsDeliveryRepo {
    constructor(private readonly db: IDdb) {}
    async get(orgId: string, actorUserId: string, requestId: string): Promise<SmsDelivery | null> {
        const { Item } = await this.db.getItem(table(), key(orgId, actorUserId, requestId), { ConsistentRead: true });
        return Item as SmsDelivery ?? null;
    }
    async begin(orgId: string, actorUserId: string, requestId: string, fingerprint: string): Promise<boolean> {
        try {
            await this.db.transactWrite([{ Put: { TableName: table(), Item: { ...key(orgId, actorUserId, requestId), orgId, actorUserId, requestId, fingerprint, status: 'STARTED', createdAt: new Date().toISOString() }, ConditionExpression: 'attribute_not_exists(messageId)' } }]);
            return true;
        } catch (error) { if (isConflict(error)) return false; throw error; }
    }
    async finish(orgId: string, actorUserId: string, requestId: string, fingerprint: string, result: { status: 'ACCEPTED' | 'FAILED' | 'NEEDS_REVIEW'; providerMessageId?: string; error?: string }, message?: Record<string, unknown> & { conversationId: string; messageId: string }): Promise<void> {
        if (result.status === 'ACCEPTED' && (!result.providerMessageId || !message)) throw new Error('Accepted SMS requires a provider ID and message record');
        const operations: Parameters<IDdb['transactWrite']>[0] = [{ Put: { TableName: table(), Item: { ...key(orgId, actorUserId, requestId), orgId, actorUserId, requestId, fingerprint, ...result, updatedAt: new Date().toISOString() }, ConditionExpression: '#status = :started AND fingerprint = :fingerprint', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':started': 'STARTED', ':fingerprint': fingerprint } } }];
        if (message) operations.push({ Put: { TableName: table(), Item: { ...message, orgId, senderId: actorUserId, channel: 'sms', provider: 'sns', providerMessageId: result.providerMessageId }, ConditionExpression: 'attribute_not_exists(messageId)' } });
        await this.db.transactWrite(operations);
    }
}
