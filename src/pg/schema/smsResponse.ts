import { sql } from 'drizzle-orm';
import { pgTable, text, integer, jsonb, index, primaryKey, uniqueIndex } from 'drizzle-orm/pg-core';
import type { SmsResponseContext } from '../../smsResponse/schema';
export const smsResponseLinks = pgTable('sms_response_links', {
    tokenHash: text('token_hash').primaryKey(), orgId: text('org_id').notNull(),
    context: jsonb('context').$type<SmsResponseContext>().notNull(), phoneHash: text('phone_hash').notNull(),
    createdAt: text('created_at').notNull(), expiresAt: text('expires_at').notNull(), revokedAt: text('revoked_at'),
    providerMessageId: text('provider_message_id'), deliveryState: text('delivery_state').notNull(),
    attempts: integer('attempts').notNull(), lastAttemptAt: text('last_attempt_at'),
    processingId: text('processing_id'), processingUntil: text('processing_until'), retryAt: text('retry_at'), processingAttempts: integer('processing_attempts').notNull(),
    responsePhone: text('response_phone'), responseId: text('response_id'), responseText: text('response_text'), receivedAt: text('received_at'), publishedAt: text('published_at'),
}, t => [uniqueIndex('sms_response_origin_uq').on(t.orgId, sql`(${t.context}->>'source')`, sql`(${t.context}->>'originId')`), index('sms_response_org_idx').on(t.orgId), index('sms_response_pending_idx').on(t.publishedAt, t.receivedAt)]);

export const invoiceResponseDeliveryClaims = pgTable('invoice_response_delivery_claims', {
    orgId: text('org_id').notNull(),
    deliveryId: text('delivery_id').notNull(), invoiceId: text('invoice_id').notNull(), claimedAt: text('claimed_at').notNull(),
}, t => [primaryKey({ columns: [t.orgId, t.deliveryId] })]);
