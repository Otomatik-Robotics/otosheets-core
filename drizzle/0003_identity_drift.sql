-- Schema drift surfaced by the dev backfill report (2026-07-04): live
-- attributes handlers write that the original identity schema missed, plus
-- one NOT NULL relaxation matching production reality. Additive-only
-- (expand-contract): safe against a live table.
ALTER TABLE users ALTER COLUMN full_name DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type TEXT;
--> statement-breakpoint
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS type TEXT;
--> statement-breakpoint
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS stripe_onboarding_status TEXT;
--> statement-breakpoint
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS advisor_facts JSONB;
--> statement-breakpoint
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS custom_roles JSONB;
--> statement-breakpoint
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS timezone TEXT;
--> statement-breakpoint
-- Legacy single-team name; superseded by team_members. Kept for lossless
-- migration; drop at the decommission/contract step.
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS team TEXT;
