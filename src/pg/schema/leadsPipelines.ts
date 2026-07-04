import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, numeric, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { orgs } from './identity';

/**
 * Phase 3 (leads-to-book) tables — docs/POSTGRES_MIGRATION_PLAN.md §3.
 * Lessons applied (see project memory): sparse-safe nullables, date-ish fields
 * as TEXT, explicit owner_id from the Dynamo sk prefix, jsonb for arrays/config,
 * real FKs to orgs. stageHistory/sources/voiceConfig/photos stay jsonb (document-
 * shaped; promote lead_stage_events to a child table later for funnel analytics).
 */

export const pipelines = pgTable('pipelines', {
    pipelineId: text('pipeline_id').primaryKey(),
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),
    createdBy: text('created_by').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    stages: jsonb('stages'),
    isDefault: boolean('is_default'),
    sources: jsonb('sources'),
    voiceConfig: jsonb('voice_config'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    index('pipelines_org_idx').on(t.orgId),
]);

export const leads = pgTable('leads', {
    leadId: text('lead_id').primaryKey(),
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),
    ownerId: text('owner_id').notNull(),       // Dynamo sk prefix (= createdBy)
    createdBy: text('created_by').notNull(),
    source: text('source'),
    pipelineId: text('pipeline_id').references(() => pipelines.pipelineId, { onDelete: 'set null' }),
    adId: text('ad_id'),
    channelId: text('channel_id'),
    pageId: text('page_id'),
    clientName: text('client_name'),
    clientPhone: text('client_phone'),
    clientEmail: text('client_email'),
    senderProfileName: text('sender_profile_name'),
    senderId: text('sender_id'),
    suburb: text('suburb'),
    serviceType: text('service_type'),
    description: text('description'),
    photos: jsonb('photos'),
    urgency: text('urgency'),
    stage: text('stage'),
    orgStage: text('org_stage'),                // Dynamo GSI key (orgId#stage) — stored for parity
    assignedTo: text('assigned_to'),
    quotedAmount: numeric('quoted_amount', { precision: 12, scale: 2 }),
    bookingId: text('booking_id'),
    bookingDate: text('booking_date'),
    bookingTime: text('booking_time'),
    notes: text('notes'),
    conversationSummary: text('conversation_summary'),
    doNotCall: boolean('do_not_call'),
    stageHistory: jsonb('stage_history'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    index('leads_org_created_idx').on(t.orgId, t.createdAt.desc()),
    index('leads_org_stage_idx').on(t.orgId, t.stage, t.createdAt.desc()),
    index('leads_org_source_idx').on(t.orgId, t.source),
    index('leads_sender_idx').on(t.orgId, t.senderId),
    index('leads_pipeline_idx').on(t.pipelineId),
    index('leads_name_trgm').using('gin', sql`${t.clientName} gin_trgm_ops`),
]);

export const bookings = pgTable('bookings', {
    bookingId: text('booking_id').primaryKey(),
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),
    ownerId: text('owner_id').notNull(),
    createdBy: text('created_by').notNull(),
    date: text('booking_date'),
    startTime: text('start_time'),
    endTime: text('end_time'),
    clientName: text('client_name'),
    clientPhone: text('client_phone'),
    clientEmail: text('client_email'),
    serviceType: text('service_type'),
    suburb: text('suburb'),
    notes: text('notes'),
    status: text('status'),
    source: text('source'),
    sourceName: text('source_name'),
    leadId: text('lead_id'),                    // soft ref (avoid FK cycle with leads.booking_id)
    pipelineId: text('pipeline_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    index('bookings_org_created_idx').on(t.orgId, t.createdAt.desc()),
    index('bookings_org_date_idx').on(t.orgId, t.date),
    index('bookings_lead_idx').on(t.leadId),
]);
