-- 0031: GPS timesheets — auto-clock source, day confirmation, dispute review.
-- Additive/idempotent; all columns nullable so existing rows are untouched.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS source text;
--> statement-breakpoint
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS confirmed_at text;
--> statement-breakpoint
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS disputed boolean;
--> statement-breakpoint
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS original_minutes integer;
--> statement-breakpoint
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS dispute_note text;
--> statement-breakpoint
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS approval_status text;
--> statement-breakpoint
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS approved_by text;
--> statement-breakpoint
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS approved_at text;
