CREATE TABLE IF NOT EXISTS workflow_definitions (org_id text NOT NULL, workflow_id text NOT NULL, name text NOT NULL, is_active boolean NOT NULL, updated_at text NOT NULL, payload jsonb NOT NULL, PRIMARY KEY (org_id, workflow_id));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workflow_definitions_org_updated_idx ON workflow_definitions (org_id, updated_at, workflow_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workflow_versions (org_id text NOT NULL, workflow_id text NOT NULL, version integer NOT NULL, payload jsonb NOT NULL, PRIMARY KEY (org_id, workflow_id, version));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workflow_runs (org_id text NOT NULL, run_id text NOT NULL, workflow_id text NOT NULL, status text NOT NULL, started_at text NOT NULL, payload jsonb NOT NULL, PRIMARY KEY (org_id, run_id));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workflow_runs_org_started_idx ON workflow_runs (org_id, started_at, run_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workflow_runs_workflow_started_idx ON workflow_runs (org_id, workflow_id, started_at, run_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workflow_runs_status_started_idx ON workflow_runs (org_id, status, started_at, run_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workflow_steps (org_id text NOT NULL, run_id text NOT NULL, node_id text NOT NULL, payload jsonb NOT NULL, PRIMARY KEY (org_id, run_id, node_id));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workflow_wakes (org_id text NOT NULL, wake_id text NOT NULL, run_id text NOT NULL, workflow_id text NOT NULL, due_at text NOT NULL, payload jsonb NOT NULL, PRIMARY KEY (org_id, wake_id));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workflow_wakes_due_idx ON workflow_wakes (due_at, org_id, wake_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workflow_approvals (org_id text NOT NULL, approval_id text NOT NULL, run_id text NOT NULL, status text NOT NULL, requested_at text NOT NULL, expires_at text, assigned_to jsonb NOT NULL, payload jsonb NOT NULL, PRIMARY KEY (org_id, approval_id));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workflow_approvals_pending_idx ON workflow_approvals (org_id, status, requested_at, approval_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workflow_audit (org_id text NOT NULL, record_id text NOT NULL, run_id text NOT NULL, kind text NOT NULL, payload jsonb NOT NULL, PRIMARY KEY (org_id, record_id));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workflow_audit_run_idx ON workflow_audit (org_id, run_id, kind, record_id);
