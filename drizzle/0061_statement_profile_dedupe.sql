-- Identical uploads in separate business profiles are independent records.
-- Expansion only: retain the old user-wide index until unscoped consumers retire.
-- Preserve guest/unassigned dedupe without guessing ownership.
CREATE UNIQUE INDEX IF NOT EXISTS statements_dedupe_profile
    ON statements (user_id, organization_id, business_profile_id, content_hash)
    WHERE organization_id IS NOT NULL AND business_profile_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS statements_dedupe_legacy
    ON statements (user_id, content_hash)
    WHERE organization_id IS NULL OR business_profile_id IS NULL;
