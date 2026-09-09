import { pgTable, text, timestamp, uniqueIndex, index, foreignKey } from 'drizzle-orm/pg-core';
import { businessProfiles } from './businessProfile';

export const profileSignatureRequests = pgTable('profile_signature_requests', {
    requestId: text('request_id').primaryKey(),
    orgId: text('org_id').notNull(),
    businessProfileId: text('business_profile_id').notNull(),
    advisorUserId: text('advisor_user_id').notNull(),
    clientRequestKey: text('client_request_key').notNull(),
    payloadFingerprint: text('payload_fingerprint').notNull(),
    title: text('title').notNull(), signerEmail: text('signer_email').notNull(),
    signerName: text('signer_name').notNull(), message: text('message').notNull(),
    kind: text('kind').notNull(), provider: text('provider').notNull(),
    documentKey: text('document_key'),
    status: text('status').$type<'DRAFT' | 'SENDING' | 'SENT' | 'CANCELLING' | 'CANCELLED'>().notNull().default('DRAFT'),
    attemptId: text('attempt_id'), providerRef: text('provider_ref'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, t => [
    foreignKey({ columns: [t.orgId, t.businessProfileId], foreignColumns: [businessProfiles.orgId, businessProfiles.businessProfileId] }),
    uniqueIndex('profile_signature_requests_identity_uq').on(t.orgId, t.businessProfileId, t.advisorUserId, t.clientRequestKey),
    index('profile_signature_requests_scope_idx').on(t.orgId, t.businessProfileId, t.advisorUserId, t.requestId),
]);
