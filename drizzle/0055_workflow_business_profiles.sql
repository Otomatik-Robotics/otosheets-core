ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS business_profile_id text;
--> statement-breakpoint
ALTER TABLE workflow_versions ADD COLUMN IF NOT EXISTS business_profile_id text;
--> statement-breakpoint
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS business_profile_id text;
--> statement-breakpoint
ALTER TABLE workflow_approvals ADD COLUMN IF NOT EXISTS business_profile_id text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workflow_definitions_profile_updated_idx ON workflow_definitions (org_id, business_profile_id, updated_at DESC, workflow_id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workflow_runs_profile_started_idx ON workflow_runs (org_id, business_profile_id, started_at DESC, run_id DESC);
