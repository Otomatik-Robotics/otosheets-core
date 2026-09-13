-- One identity per organisation, contract step (0072).
--
-- 0070 consolidated every organisation onto one profile and 0071 copied that
-- profile onto `orgs`; since then nothing reads business_profiles or any
-- business_profile_id column. This step drops them, together with the
-- per-profile configuration tables of removed modules that hung off the
-- profile key (BAS periods, payer aliases, the advisor signature/checklist/
-- document-request tables and their immutability triggers).
--
-- Idempotent: every drop is IF EXISTS, and the column sweep reads the
-- catalogue, so a second run finds nothing to remove.
DROP TABLE IF EXISTS profile_document_request_attachments CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS profile_document_request_files CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS profile_document_requests CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS profile_setup_checklist CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS profile_signature_requests CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS profile_payer_aliases CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS business_profile_bas_periods CASCADE;
--> statement-breakpoint
DROP FUNCTION IF EXISTS preserve_profile_docrequest_attachment();
--> statement-breakpoint
DROP FUNCTION IF EXISTS preserve_profile_docrequest_file();
--> statement-breakpoint
DROP FUNCTION IF EXISTS preserve_profile_docrequest();
--> statement-breakpoint
DROP FUNCTION IF EXISTS preserve_profile_checklist_owner();
--> statement-breakpoint
DROP FUNCTION IF EXISTS preserve_signature_request_identity();
--> statement-breakpoint
-- Every remaining business_profile_id column, wherever it is. CASCADE takes
-- the indexes and constraints that named it.
DO $$
DECLARE
    c record;
BEGIN
    FOR c IN
        SELECT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'business_profile_id'
          AND table_name <> 'business_profiles'
        ORDER BY table_name
    LOOP
        EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS business_profile_id CASCADE', c.table_name);
        RAISE NOTICE 'drop_business_profiles: business_profile_id dropped from %', c.table_name;
    END LOOP;
END $$;
--> statement-breakpoint
DROP TABLE IF EXISTS business_profiles CASCADE;
