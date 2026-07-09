import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, integer, numeric, doublePrecision, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { orgs } from './identity';
import { clients } from './billingCore';

/**
 * Phase 4 (ops & expenses) — docs/POSTGRES_MIGRATION_PLAN.md §3/§4.
 * Same conventions: sparse-safe nullables, date-ish TEXT, explicit owner_id,
 * jsonb for arrays/config, timestamptz only for createdAt/updatedAt.
 * NB: receipts and trips have NO updatedAt in the DTO (createdAt only).
 */

export const jobs = pgTable('jobs', {
    jobId: text('job_id').primaryKey(),
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),
    businessProfileId: text('business_profile_id'),   // profile scope; NOT NULL after backfill (0015)
    ownerId: text('owner_id').notNull(),
    createdBy: text('created_by').notNull(),
    clientId: text('client_id').references(() => clients.clientId, { onDelete: 'set null' }),
    leadId: text('lead_id'),
    title: text('title'),
    description: text('description'),
    status: text('status'),
    address: text('address'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    scheduledDate: text('scheduled_date'),
    scheduledTime: text('scheduled_time'),
    estimatedDuration: integer('estimated_duration'),
    assignedMembers: jsonb('assigned_members'),
    assignedTeams: jsonb('assigned_teams'),
    scope: text('scope'),
    jobType: text('job_type'),
    geofence: jsonb('geofence'),
    materials: jsonb('materials'),
    photos: jsonb('photos'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    signatureKey: text('signature_key'),
    handoverNotes: text('handover_notes'),
    handoverToken: text('handover_token'),
    locationPings: jsonb('location_pings'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    index('jobs_org_created_idx').on(t.orgId, t.createdAt.desc()),
    index('jobs_profile_created_idx').on(t.businessProfileId, t.createdAt.desc()),
    index('jobs_profile_status_idx').on(t.businessProfileId, t.status, t.scheduledDate),
    index('jobs_org_status_idx').on(t.orgId, t.status, t.scheduledDate),
    index('jobs_client_idx').on(t.clientId),
    index('jobs_org_sched_idx').on(t.orgId, t.scheduledDate),
]);

export const timeEntries = pgTable('time_entries', {
    timeEntryId: text('time_entry_id').primaryKey(),
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),
    businessProfileId: text('business_profile_id'),   // profile scope; NOT NULL after backfill (0015)
    ownerId: text('owner_id').notNull(),
    createdBy: text('created_by').notNull(),
    clientId: text('client_id'),
    jobId: text('job_id'),
    date: text('entry_date'),
    startTime: text('start_time'),
    endTime: text('end_time'),
    durationMinutes: integer('duration_minutes'),
    description: text('description'),
    project: text('project'),
    billable: boolean('billable'),
    invoicedAt: text('invoiced_at'),
    invoiceId: text('invoice_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    index('time_entries_org_created_idx').on(t.orgId, t.createdAt.desc()),
    index('time_entries_profile_created_idx').on(t.businessProfileId, t.createdAt.desc()),
    index('time_entries_job_idx').on(t.jobId),
    index('time_entries_owner_idx').on(t.orgId, t.ownerId),
]);

export const priceBookItems = pgTable('price_book_items', {
    itemId: text('item_id').primaryKey(),
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),
    businessProfileId: text('business_profile_id'),   // profile scope; NOT NULL after backfill (0015)
    name: text('name'),
    description: text('description'),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }),
    unit: text('unit'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    index('price_book_org_idx').on(t.orgId),
    index('price_book_profile_idx').on(t.businessProfileId),
]);

export const receipts = pgTable('receipts', {
    receiptId: text('receipt_id').primaryKey(),
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),
    businessProfileId: text('business_profile_id'),   // profile scope; NOT NULL after backfill (0015)
    ownerId: text('owner_id').notNull(),
    createdBy: text('created_by').notNull(),
    s3Key: text('s3_key'),
    contentHash: text('content_hash'),
    status: text('status'),
    vendorName: text('vendor_name'),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }),
    taxAmount: numeric('tax_amount', { precision: 12, scale: 2 }),
    gstAmount: numeric('gst_amount', { precision: 12, scale: 2 }),
    exGstAmount: numeric('ex_gst_amount', { precision: 12, scale: 2 }),
    date: text('receipt_date'),
    category: text('category'),
    description: text('description'),
    aiRiskLevel: text('ai_risk_level'),
    isDeductible: boolean('is_deductible'),
    aiWarning: text('ai_warning'),
    isFuelReceipt: boolean('is_fuel_receipt'),
    businessPercent: numeric('business_percent', { precision: 5, scale: 2 }),
    businessAmount: numeric('business_amount', { precision: 12, scale: 2 }),
    ruleApplied: boolean('rule_applied'),
    duplicateOf: text('duplicate_of'),
    possibleDuplicateOf: text('possible_duplicate_of'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    index('receipts_org_created_idx').on(t.orgId, t.createdAt.desc()),
    index('receipts_profile_created_idx').on(t.businessProfileId, t.createdAt.desc()),
    index('receipts_org_category_idx').on(t.orgId, t.category),
    index('receipts_content_hash_idx').on(t.orgId, t.contentHash),
]);

export const trips = pgTable('trips', {
    tripId: text('trip_id').primaryKey(),
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),
    businessProfileId: text('business_profile_id'),   // profile scope; NOT NULL after backfill (0015)
    ownerId: text('owner_id').notNull(),
    createdBy: text('created_by').notNull(),
    startTime: text('start_time'),
    endTime: text('end_time'),
    startAddress: text('start_address'),
    endAddress: text('end_address'),
    distanceKm: numeric('distance_km', { precision: 10, scale: 2 }),
    purpose: text('purpose'),
    notes: text('notes'),
    coordinates: jsonb('coordinates'),
    date: text('trip_date'),
    jobId: text('job_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    index('trips_org_created_idx').on(t.orgId, t.createdAt.desc()),
    index('trips_profile_created_idx').on(t.businessProfileId, t.createdAt.desc()),
    index('trips_org_date_idx').on(t.orgId, t.date),
]);
