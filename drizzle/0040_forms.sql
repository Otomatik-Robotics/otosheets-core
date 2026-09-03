-- Forms (0040): the custom form builder — form definitions + public submissions.
-- Both are Postgres-only (reporting-adjacent entities: submissions are joined
-- against leads and exported per form; no DynamoDB mirror — ad_campaigns
-- precedent). submission_id is client-minted, so the PK is the dedupe wall for
-- retried anonymous POSTs.
CREATE TABLE IF NOT EXISTS forms (
    form_id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    business_profile_id text,
    created_by text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    style text NOT NULL,
    destination text NOT NULL,
    pipeline_id text,
    status text NOT NULL,
    fields jsonb NOT NULL,
    intro text,
    success_message text,
    created_at text NOT NULL,
    updated_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS forms_org_slug_uq ON forms (org_id, slug);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS forms_org_created_idx ON forms (org_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS form_submissions (
    submission_id text PRIMARY KEY,
    form_id text NOT NULL REFERENCES forms(form_id) ON DELETE CASCADE,
    org_id text NOT NULL,
    answers jsonb NOT NULL,
    attachments jsonb,
    contact jsonb,
    lead_id text,
    pipeline_id text,
    attribution jsonb,
    created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS form_submissions_form_created_idx ON form_submissions (form_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS form_submissions_org_created_idx ON form_submissions (org_id, created_at);
