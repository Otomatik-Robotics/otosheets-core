import { pgTable, text, integer, timestamp, foreignKey, unique } from 'drizzle-orm/pg-core';
import { businessProfiles } from './businessProfile';
export const profileDocumentRequests = pgTable('profile_document_requests', {
    requestId: text('request_id').primaryKey(), orgId: text('org_id').notNull(),
    businessProfileId: text('business_profile_id').notNull(), advisorUserId: text('advisor_user_id').notNull(),
    clientRequestKey: text('client_request_key').notNull(), payloadFingerprint: text('payload_fingerprint').notNull(),
    title: text('title').notNull(), description: text('description').notNull(), dueDate: text('due_date').notNull(), docType: text('doc_type').notNull(),
    status: text('status').notNull().default('OPEN'), revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(), updatedBy: text('updated_by').notNull(),
}, t => [foreignKey({columns:[t.orgId,t.businessProfileId],foreignColumns:[businessProfiles.orgId,businessProfiles.businessProfileId]}),
    unique().on(t.orgId,t.businessProfileId,t.advisorUserId,t.clientRequestKey), unique().on(t.requestId,t.orgId,t.businessProfileId,t.advisorUserId),
    unique().on(t.requestId,t.orgId,t.businessProfileId,t.advisorUserId,t.docType)]);
export const profileDocumentRequestFiles = pgTable('profile_document_request_files', {
    fileId: text('file_id').primaryKey(), requestId: text('request_id').notNull(), orgId: text('org_id').notNull(),
    businessProfileId: text('business_profile_id').notNull(), advisorUserId: text('advisor_user_id').notNull(),
    uploadedBy: text('uploaded_by').notNull(), clientFileKey: text('client_file_key').notNull(), payloadFingerprint: text('payload_fingerprint').notNull(),
    fileName: text('file_name').notNull(), contentType: text('content_type').notNull(), extension: text('extension').notNull(),
    sizeBytes: integer('size_bytes').notNull(), sha256: text('sha256').notNull(), fileKey: text('file_key').notNull(),
    status: text('status').notNull().default('RESERVED'),
    createdAt: timestamp('created_at', {withTimezone:true,mode:'date'}).notNull().defaultNow(),
}, t => [foreignKey({columns:[t.requestId,t.orgId,t.businessProfileId,t.advisorUserId],foreignColumns:[profileDocumentRequests.requestId,profileDocumentRequests.orgId,profileDocumentRequests.businessProfileId,profileDocumentRequests.advisorUserId]}),
    unique().on(t.requestId,t.uploadedBy,t.clientFileKey),unique().on(t.fileKey),unique().on(t.fileId,t.requestId,t.orgId,t.businessProfileId,t.advisorUserId)]);
export const profileDocumentRequestAttachments = pgTable('profile_document_request_attachments', {
    fileId: text('file_id').primaryKey(), requestId: text('request_id').notNull(), orgId: text('org_id').notNull(),
    businessProfileId: text('business_profile_id').notNull(), advisorUserId: text('advisor_user_id').notNull(),
    bucketName: text('bucket_name').notNull(), fileKey: text('file_key').notNull(), versionId: text('version_id').notNull(),
    sha256: text('sha256').notNull(), sizeBytes: integer('size_bytes').notNull(), attachedBy: text('attached_by').notNull(),
    attachedAt: timestamp('attached_at', {withTimezone:true,mode:'date'}).notNull().defaultNow(),
}, t => [foreignKey({columns:[t.fileId,t.requestId,t.orgId,t.businessProfileId,t.advisorUserId],foreignColumns:[profileDocumentRequestFiles.fileId,profileDocumentRequestFiles.requestId,profileDocumentRequestFiles.orgId,profileDocumentRequestFiles.businessProfileId,profileDocumentRequestFiles.advisorUserId]}),
    unique().on(t.fileId,t.requestId,t.orgId,t.businessProfileId,t.advisorUserId)]);

/** Immutable admission marker. RESERVED does not mean queued, extracted or fulfilled. */
export const profileDocumentRequestIngestions = pgTable('profile_document_request_ingestions', {
    fileId: text('file_id').primaryKey(), requestId: text('request_id').notNull(), orgId: text('org_id').notNull(),
    businessProfileId: text('business_profile_id').notNull(), advisorUserId: text('advisor_user_id').notNull(),
    docType: text('doc_type').notNull(), targetId: text('target_id').notNull().unique(), targetUserId: text('target_user_id').notNull(),
    financialYear: text('financial_year'), admittedBy: text('admitted_by').notNull(), admittedRevision: integer('admitted_revision').notNull(),
    status: text('status').notNull().default('RESERVED'),
    createdAt: timestamp('created_at', {withTimezone:true,mode:'date'}).notNull().defaultNow(),
}, t => [
    foreignKey({columns:[t.fileId,t.requestId,t.orgId,t.businessProfileId,t.advisorUserId],foreignColumns:[profileDocumentRequestAttachments.fileId,profileDocumentRequestAttachments.requestId,profileDocumentRequestAttachments.orgId,profileDocumentRequestAttachments.businessProfileId,profileDocumentRequestAttachments.advisorUserId]}),
    foreignKey({columns:[t.requestId,t.orgId,t.businessProfileId,t.advisorUserId,t.docType],foreignColumns:[profileDocumentRequests.requestId,profileDocumentRequests.orgId,profileDocumentRequests.businessProfileId,profileDocumentRequests.advisorUserId,profileDocumentRequests.docType]}),
]);
