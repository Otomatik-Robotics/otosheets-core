import { createHash, randomBytes } from 'node:crypto';
import type { IDdb } from '../ddbPort';

export type WebsocketIdentity = { userId: string } & (
    { kind: 'business'; orgId: string } | { kind: 'account' }
);
export type VerifiedWebsocketConnection = WebsocketIdentity & {
    connectionId: string; audience: string; admissionVersion: 1; expiresAt: number;
};
const TICKET_SECONDS = 60;
export const WEBSOCKET_CONNECTION_SECONDS = 300;

/** Transport credentials live in the existing connection table, never in OAuth records. */
export class WebsocketAdmissionRepo {
    constructor(private ddb: IDdb, private table: string, private audience: string, private now = () => Math.floor(Date.now() / 1000)) {
        if (!table || !audience) throw new Error('WebSocket admission configuration is required');
    }
    private identity(value: Record<string, any>): WebsocketIdentity | null {
        if (typeof value.userId !== 'string' || !value.userId || value.userId.startsWith('ws-ticket#')) return null;
        if (value.kind === 'account' && value.orgId == null) return { userId: value.userId, kind: 'account' };
        if (value.kind === 'business' && typeof value.orgId === 'string' && value.orgId.trim()) {
            return { userId: value.userId, kind: 'business', orgId: value.orgId };
        }
        return null;
    }
    private ticketKey(ticket: string) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error('Invalid WebSocket ticket');
        return { userId: `ws-ticket#${createHash('sha256').update(ticket).digest('hex')}`, connectionId: 'ticket' };
    }
    async issue(identity: WebsocketIdentity): Promise<{ ticket: string; expiresAt: number }> {
        const verified = this.identity(identity);
        if (!verified) throw new Error('Invalid WebSocket identity');
        const ticket = randomBytes(32).toString('base64url');
        const expiresAt = this.now() + TICKET_SECONDS;
        await this.ddb.transactWrite([{ Put: { TableName: this.table,
            Item: { ...this.ticketKey(ticket), ticketIdentity: verified, audience: this.audience, expiresAt, ttl: expiresAt },
            ConditionExpression: 'attribute_not_exists(connectionId)' } }]);
        return { ticket, expiresAt };
    }
    async connect(ticket: string, connectionId: string, authorize: (identity: WebsocketIdentity) => Promise<boolean>): Promise<VerifiedWebsocketConnection> {
        if (!connectionId || connectionId === 'ticket') throw new Error('Invalid WebSocket connection');
        const key = this.ticketKey(ticket);
        const { Item } = await this.ddb.getItem(this.table, key, { ConsistentRead: true });
        const identity = Item?.ticketIdentity && this.identity(Item.ticketIdentity);
        if (!identity || Item?.audience !== this.audience || !Number.isSafeInteger(Item.expiresAt) || Item.expiresAt <= this.now()
            || !await authorize(identity)) throw new Error('WebSocket admission denied');
        const now = this.now();
        const connection: VerifiedWebsocketConnection = { ...identity, connectionId, audience: this.audience,
            admissionVersion: 1, expiresAt: now + WEBSOCKET_CONNECTION_SECONDS };
        await this.ddb.transactWrite([
            { Delete: { TableName: this.table, Key: key,
                ConditionExpression: 'attribute_exists(connectionId) AND audience = :audience AND expiresAt > :now',
                ExpressionAttributeValues: { ':audience': this.audience, ':now': now } } },
            { Put: { TableName: this.table, Item: { ...connection, userType: identity.kind === 'business' ? 'business' : 'client', ttl: connection.expiresAt },
                ConditionExpression: 'attribute_not_exists(connectionId)' } },
        ]);
        return connection;
    }
    private verified(item: Record<string, any> | undefined): VerifiedWebsocketConnection | null {
        if (!item || item.admissionVersion !== 1 || item.audience !== this.audience || !Number.isSafeInteger(item.expiresAt)
            || item.expiresAt <= this.now() || typeof item.connectionId !== 'string' || item.connectionId === 'ticket') return null;
        const identity = this.identity(item);
        return identity ? { ...identity, connectionId: item.connectionId, audience: item.audience, admissionVersion: 1, expiresAt: item.expiresAt } : null;
    }
    async getConnection(connectionId: string): Promise<VerifiedWebsocketConnection | null> {
        const result = await this.ddb.query({ TableName: this.table, IndexName: 'ConnectionIndex',
            KeyConditionExpression: 'connectionId = :id', ExpressionAttributeValues: { ':id': connectionId }, Limit: 2 });
        if (result.Items?.length !== 1) return null;
        const { Item } = await this.ddb.getItem(this.table, { userId: result.Items[0].userId, connectionId }, { ConsistentRead: true });
        return this.verified(Item);
    }
    async listBusinessConnections(userId: string, orgId: string): Promise<VerifiedWebsocketConnection[]> {
        if (!userId || !orgId) throw new Error('WebSocket business scope is required');
        const connections: VerifiedWebsocketConnection[] = [];
        let after: Record<string, any> | undefined;
        do {
            const page = await this.ddb.query({ TableName: this.table,
                KeyConditionExpression: 'userId = :userId',
                FilterExpression: 'admissionVersion = :version AND audience = :audience AND expiresAt > :now AND orgId = :org',
                ExpressionAttributeValues: { ':userId': userId, ':version': 1, ':audience': this.audience, ':now': this.now(), ':org': orgId },
                Limit: 100, ...(after ? { ExclusiveStartKey: after } : {}) });
            for (const candidate of page.Items ?? []) {
                const { Item } = await this.ddb.getItem(this.table, { userId, connectionId: candidate.connectionId }, { ConsistentRead: true });
                const connection = this.verified(Item);
                if (connection?.kind === 'business' && connection.userId === userId && connection.orgId === orgId) connections.push(connection);
            }
            after = page.LastEvaluatedKey;
        } while (after);
        return connections;
    }
}
