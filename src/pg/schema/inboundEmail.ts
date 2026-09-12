import { pgTable, text, jsonb, primaryKey, uniqueIndex, index } from 'drizzle-orm/pg-core';
import type { InboundMessageContent } from '../../inboundEmail/schema';
const scope = () => ({ orgId: text('org_id').notNull() });
export const inboundMailboxes = pgTable('inbound_mailboxes', {
    ...scope(), address: text('address').notNull(), createdAt: text('created_at').notNull(),
}, t => [primaryKey({ columns: [t.orgId] }), uniqueIndex('inbound_mailboxes_address_uq').on(t.address)]);
export const emailConversations = pgTable('email_conversations', {
    ...scope(), conversationId: text('conversation_id').notNull(), replyAddress: text('reply_address').notNull(),
    invoiceId: text('invoice_id'), customerEmail: text('customer_email').notNull(),
    pausedAt: text('paused_at'), createdAt: text('created_at').notNull(),
}, t => [primaryKey({ columns: [t.orgId, t.conversationId] }), uniqueIndex('email_conversations_reply_uq').on(t.replyAddress), index('email_conversations_invoice_idx').on(t.orgId, t.invoiceId)]);
export const inboundMessages = pgTable('inbound_messages', {
    ...scope(), messageId: text('message_id').notNull(), conversationId: text('conversation_id').notNull(),
    receivedAt: text('received_at').notNull(), content: jsonb('content').$type<InboundMessageContent>().notNull(),
    publishedAt: text('published_at'),
}, t => [primaryKey({ columns: [t.orgId, t.messageId] }), index('inbound_messages_org_received_idx').on(t.orgId, t.receivedAt, t.messageId)]);
export const emailDeliveryClaims = pgTable('email_delivery_claims', {
    ...scope(), deliveryId: text('delivery_id').notNull(), conversationId: text('conversation_id').notNull(),
    claimedAt: text('claimed_at').notNull(), providerMessageId: text('provider_message_id'),
}, t => [primaryKey({ columns: [t.orgId, t.deliveryId] })]);
export const emailConversationInvoices = pgTable('email_conversation_invoices', {
    ...scope(), conversationId: text('conversation_id').notNull(), invoiceId: text('invoice_id').notNull(),
}, t => [primaryKey({ columns: [t.orgId, t.conversationId, t.invoiceId] }), index('email_conversation_invoices_invoice_idx').on(t.orgId, t.invoiceId)]);
export const invoiceChaseActions = pgTable('invoice_chase_actions', {
    ...scope(), actionId: text('action_id').notNull(), invoiceId: text('invoice_id').notNull(),
}, t => [primaryKey({ columns: [t.orgId, t.actionId] })]);
