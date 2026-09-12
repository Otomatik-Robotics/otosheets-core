-- One identity per organisation (0070).
--
-- Business profiles are no longer a thing a business has several of: the
-- organisation IS the business. Every org keeps exactly one profile row, the
-- one `orgs.business_profile_id` already points at (its active identity), and
-- everything that was attributed to another profile of the same org is
-- re-attributed to that one. Nothing is hidden behind a profile the owner can
-- no longer choose.
--
-- Idempotent: a second run finds nothing to move. Data only; the columns and
-- the table go in a later contract step, once no code reads them.
--
-- 1. Every org that has profiles has a canonical one: the pointer if set,
--    else its earliest profile.
UPDATE orgs o
SET business_profile_id = p.business_profile_id
FROM (
    SELECT DISTINCT ON (org_id) org_id, business_profile_id
    FROM business_profiles
    ORDER BY org_id, created_at ASC, business_profile_id ASC
) p
WHERE p.org_id = o.org_id
  AND (o.business_profile_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM business_profiles x WHERE x.business_profile_id = o.business_profile_id AND x.org_id = o.org_id));
--> statement-breakpoint
-- 2. Re-point every row of every table that carries both org_id and
--    business_profile_id. Per-profile configuration tables (a checklist, BAS
--    periods, payer aliases) collide on their key when two profiles both have
--    the row, and the advisor tables refuse the update by trigger; for those
--    the canonical profile's rows win and the other profile's rows go.
DO $$
DECLARE
    t record;
    moved bigint;
BEGIN
    FOR t IN
        SELECT c.table_name
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.column_name = 'business_profile_id'
          AND c.table_name NOT IN ('business_profiles', 'orgs')
          AND EXISTS (
              SELECT 1 FROM information_schema.columns o
              WHERE o.table_schema = 'public' AND o.table_name = c.table_name AND o.column_name = 'org_id')
        ORDER BY c.table_name
    LOOP
        BEGIN
            EXECUTE format(
                'UPDATE %I r SET business_profile_id = o.business_profile_id
                   FROM orgs o
                  WHERE r.org_id = o.org_id
                    AND o.business_profile_id IS NOT NULL
                    AND r.business_profile_id IS DISTINCT FROM o.business_profile_id',
                t.table_name);
            GET DIAGNOSTICS moved = ROW_COUNT;
            IF moved > 0 THEN
                RAISE NOTICE 'consolidate_business_profiles: % rows re-attributed on %', moved, t.table_name;
            END IF;
        EXCEPTION
            WHEN unique_violation OR raise_exception THEN
                -- The other profile's rows cannot become the canonical
                -- profile's: they are the same key, or the table is immutable.
                EXECUTE format(
                    'DELETE FROM %I r USING orgs o
                      WHERE r.org_id = o.org_id
                        AND o.business_profile_id IS NOT NULL
                        AND r.business_profile_id IS DISTINCT FROM o.business_profile_id',
                    t.table_name);
                GET DIAGNOSTICS moved = ROW_COUNT;
                RAISE NOTICE 'consolidate_business_profiles: % rows of other profiles dropped from % (canonical wins)', moved, t.table_name;
        END;
    END LOOP;
END $$;
--> statement-breakpoint
-- 3. The other profile rows themselves.
DELETE FROM business_profiles p
USING orgs o
WHERE p.org_id = o.org_id
  AND o.business_profile_id IS NOT NULL
  AND p.business_profile_id <> o.business_profile_id;
