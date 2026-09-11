-- CONTROLLED CONTRACT, deliberately outside drizzle/ automatic migrations.
-- Run only after the release owner verifies all statement readers/writers,
-- workers and rollback candidates use persisted organization/profile scope.
-- See statement-profile-dedupe-rollout.md. This is not part of expansion.
DO $$
BEGIN
    IF to_regclass('statements_dedupe_profile') IS NULL
       OR to_regclass('statements_dedupe_legacy') IS NULL THEN
        RAISE EXCEPTION 'Statement dedupe expansion indexes are required';
    END IF;
END $$;
DROP INDEX IF EXISTS statements_dedupe;
