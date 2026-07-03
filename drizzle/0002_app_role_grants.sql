-- Runtime-role grants for app_rw (created by infra/neon Terraform).
-- Guarded: no-ops on databases without the role (e.g. PGlite in tests).
-- Ordering note: Terraform creates the role together with the env secret, and
-- migrations only run once the secret exists — so app_rw is always present by
-- the time this executes against a real environment.
-- ALTER DEFAULT PRIVILEGES covers tables created by LATER migrations (they run
-- as the same owner role that executes this statement).
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rw') THEN
        GRANT USAGE ON SCHEMA public TO app_rw;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
            GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
    END IF;
END
$$;
