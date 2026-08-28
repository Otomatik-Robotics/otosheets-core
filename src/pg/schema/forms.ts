import { pgTable, text, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { orgs } from './identity';

/**
 * Custom forms (the form builder) — one row per form the owner builds, plus one
 * row per public submission. Submissions are joined against leads (a submission
 * ingests a lead and back-links it) and exported/reported on per form, which per
 * the source-of-truth rule makes both Postgres-only entities (ad_campaigns
 * precedent — no DynamoDB mirror). Timestamps are ISO TEXT, mirroring the DTO.
 *
 * `submission_id` is CLIENT-MINTED (a ULID generated when the filler opens the
 * form): the public submit endpoint is anonymous and retried by browsers, so
 * the id must be deterministic across retries — a conditional insert on the PK
 * is the dedupe wall (idempotency hard requirement).
 */
export const forms = pgTable('forms', {
    formId: text('form_id').primaryKey(),          // client-minted ULID — retry-safe create
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),
    businessProfileId: text('business_profile_id'),
    createdBy: text('created_by').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),                  // unique per org — the public URL segment
    style: text('style').notNull(),                // scroll|deck|steps
    destination: text('destination').notNull(),    // pipeline|inbox
    pipelineId: text('pipeline_id'),               // explicit target; null = org default
    status: text('status').notNull(),              // draft|live|archived
    fields: jsonb('fields').notNull(),             // FormField[]
    brand: jsonb('brand'),                         // { logoUrl?, primary?, secondary? } — unset inherits the org
    intro: text('intro'),
    successMessage: text('success_message'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
}, (t) => [
    uniqueIndex('forms_org_slug_uq').on(t.orgId, t.slug),
    index('forms_org_created_idx').on(t.orgId, t.createdAt),
]);

export const formSubmissions = pgTable('form_submissions', {
    submissionId: text('submission_id').primaryKey(), // client-minted ULID — the dedupe wall
    formId: text('form_id').notNull().references(() => forms.formId, { onDelete: 'cascade' }),
    orgId: text('org_id').notNull(),
    answers: jsonb('answers').notNull(),           // { fieldKey: value } — structured, never folded into text
    attachments: jsonb('attachments'),             // [{ key, name, size, contentType }]
    contact: jsonb('contact'),                     // { name?, phone?, email? } plucked identity for list display
    leadId: text('lead_id'),                       // back-link written after ingestLead
    pipelineId: text('pipeline_id'),
    attribution: jsonb('attribution'),
    createdAt: text('created_at').notNull(),
}, (t) => [
    index('form_submissions_form_created_idx').on(t.formId, t.createdAt),
    index('form_submissions_org_created_idx').on(t.orgId, t.createdAt),
]);
