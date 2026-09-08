import { randomBytes } from 'node:crypto';
import { and, eq, desc, lt, or, isNotNull, inArray } from 'drizzle-orm';
import { getPg, getPgTx, type PgDb } from '../pg/client';
import { inboundMailboxes, emailConversations, inboundMessages, emailDeliveryClaims } from '../pg/schema/inboundEmail';
import { EmailScopeSchema, InboundMessageContentSchema, type EmailScope, type InboundMessageContent } from './schema';

const scoped = (table: { orgId: any; businessProfileId: any }, scope: EmailScope) => {
    EmailScopeSchema.parse(scope);
    return and(eq(table.orgId, scope.orgId), eq(table.businessProfileId, scope.businessProfileId));
};
const address = (prefix: string, domain: string) => {
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new Error('Invalid inbound domain');
    return `${prefix}${randomBytes(24).toString('hex')}@${domain}`;
};

/** New durable email data is Postgres-only, like the current workflow runtime. */
export class InboundEmailRepo {
    constructor(private readonly injectedDb?: PgDb) {}
    private db() { return this.injectedDb ?? getPg(); }
    private tx() { return this.injectedDb ?? getPgTx(); }

    async getMailbox(scope: EmailScope) {
        return (await this.db().select().from(inboundMailboxes).where(scoped(inboundMailboxes, scope)).limit(1))[0] ?? null;
    }
    async ensureMailbox(scope: EmailScope, domain: string) {
        EmailScopeSchema.parse(scope);
        await this.db().insert(inboundMailboxes).values({ ...scope, address: address('in-', domain), createdAt: new Date().toISOString() }).onConflictDoNothing();
        return (await this.getMailbox(scope))!;
    }
    /** Only transport adapters may resolve ownership from an SES envelope recipient. */
    async resolveRecipient(recipient: string) {
        const normalized = recipient.toLowerCase();
        const mailbox = (await this.db().select().from(inboundMailboxes).where(eq(inboundMailboxes.address, normalized)).limit(1))[0];
        if (mailbox) return { ...mailbox, conversationId: null };
        const conversation = (await this.db().select().from(emailConversations).where(eq(emailConversations.replyAddress, normalized)).limit(1))[0];
        return conversation ? { ...conversation, address: conversation.replyAddress } : null;
    }
    async ensureConversation(scope: EmailScope, input: { conversationId: string; customerEmail: string; invoiceId?: string }, domain: string) {
        EmailScopeSchema.parse(scope);
        await this.db().insert(emailConversations).values({ ...scope, ...input, customerEmail: input.customerEmail.toLowerCase(), replyAddress: address('reply-', domain), createdAt: new Date().toISOString() }).onConflictDoNothing();
        const row = await this.getConversation(scope, input.conversationId);
        if (!row || row.customerEmail !== input.customerEmail.toLowerCase() || (row.invoiceId ?? undefined) !== input.invoiceId) throw new Error('Conversation identity conflict');
        return row;
    }
    async getConversation(scope: EmailScope, conversationId: string) {
        return (await this.db().select().from(emailConversations).where(and(scoped(emailConversations, scope), eq(emailConversations.conversationId, conversationId))).limit(1))[0] ?? null;
    }
    async conversationFromReferences(scope: EmailScope, references: string[]) {
        const ids = references.slice(0, 100).map(value => value.replace(/^</, '').replace(/>$/, '').split('@')[0]);
        if (!ids.length) return null;
        const rows = await this.db().select({ conversationId: emailDeliveryClaims.conversationId }).from(emailDeliveryClaims)
            .where(and(scoped(emailDeliveryClaims, scope), inArray(emailDeliveryClaims.providerMessageId, ids))).limit(2);
        if (!rows.length || rows.some(row => row.conversationId !== rows[0].conversationId)) return null;
        return this.getConversation(scope, rows[0].conversationId);
    }
    async recordMessage(scope: EmailScope, input: { messageId: string; conversationId: string; receivedAt: string; content: InboundMessageContent }) {
        const content = InboundMessageContentSchema.parse(input.content);
        return this.tx().transaction(async tx => {
            // The same row lock is used by delivery claims. No stale read can win after a reply.
            const conversation = (await tx.select().from(emailConversations).where(and(scoped(emailConversations, scope), eq(emailConversations.conversationId, input.conversationId))).for('update'))[0];
            if (!conversation) throw new Error('Conversation outside profile');
            const inserted = await tx.insert(inboundMessages).values({ ...scope, ...input, content }).onConflictDoNothing().returning();
            if (!inserted.length) return { inserted: false, paused: false };
            const paused = content.kind === 'human' && !!conversation.invoiceId;
            if (paused) await tx.update(emailConversations).set({ pausedAt: conversation.pausedAt ?? input.receivedAt }).where(and(scoped(emailConversations, scope), eq(emailConversations.conversationId, input.conversationId)));
            return { inserted: true, paused };
        });
    }
    async getMessage(scope: EmailScope, messageId: string) {
        return (await this.db().select().from(inboundMessages).where(and(scoped(inboundMessages, scope), eq(inboundMessages.messageId, messageId))).limit(1))[0] ?? null;
    }
    async markPublished(scope: EmailScope, messageId: string) {
        await this.db().update(inboundMessages).set({ publishedAt: new Date().toISOString() }).where(and(scoped(inboundMessages, scope), eq(inboundMessages.messageId, messageId)));
    }
    async listMessages(scope: EmailScope, options: { limit?: number; nextToken?: string } = {}) {
        const limit = Math.max(1, Math.min(100, options.limit ?? 20));
        let after;
        if (options.nextToken) {
            const cursor = JSON.parse(Buffer.from(options.nextToken, 'base64').toString());
            if (cursor.orgId !== scope.orgId || cursor.businessProfileId !== scope.businessProfileId || typeof cursor.receivedAt !== 'string' || typeof cursor.messageId !== 'string') throw new Error('Invalid nextToken');
            after = or(lt(inboundMessages.receivedAt, cursor.receivedAt), and(eq(inboundMessages.receivedAt, cursor.receivedAt), lt(inboundMessages.messageId, cursor.messageId)));
        }
        const rows = await this.db().select().from(inboundMessages).where(and(scoped(inboundMessages, scope), after)).orderBy(desc(inboundMessages.receivedAt), desc(inboundMessages.messageId)).limit(limit + 1);
        const items = rows.slice(0, limit), last = items[items.length - 1];
        return { items, nextToken: rows.length > limit ? Buffer.from(JSON.stringify({ ...scope, receivedAt: last.receivedAt, messageId: last.messageId })).toString('base64') : null };
    }
    async isInvoicePaused(scope: EmailScope, invoiceId: string) {
        const rows = await this.db().select({ pausedAt: emailConversations.pausedAt }).from(emailConversations).where(and(scoped(emailConversations, scope), eq(emailConversations.invoiceId, invoiceId), isNotNull(emailConversations.pausedAt))).limit(1);
        return rows.length > 0;
    }
    /** Claim before the provider call. Ambiguous claims are never automatically retried. */
    async claimDelivery(scope: EmailScope, conversationId: string, deliveryId: string) {
        return this.tx().transaction(async tx => {
            const conversation = (await tx.select().from(emailConversations).where(and(scoped(emailConversations, scope), eq(emailConversations.conversationId, conversationId))).for('update'))[0];
            if (!conversation) throw new Error('Conversation outside profile');
            if (conversation.pausedAt) return 'paused' as const;
            const inserted = await tx.insert(emailDeliveryClaims).values({ ...scope, conversationId, deliveryId, claimedAt: new Date().toISOString() }).onConflictDoNothing().returning();
            return inserted.length ? 'claimed' as const : 'duplicate' as const;
        });
    }
    async completeDelivery(scope: EmailScope, deliveryId: string, providerMessageId: string) {
        await this.db().update(emailDeliveryClaims).set({ providerMessageId }).where(and(scoped(emailDeliveryClaims, scope), eq(emailDeliveryClaims.deliveryId, deliveryId)));
    }
}
