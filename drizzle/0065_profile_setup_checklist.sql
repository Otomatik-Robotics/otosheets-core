-- Expand only. Run after0064 and before profile checklist readers. No legacy import.
CREATE TABLE IF NOT EXISTS profile_setup_checklist (
    org_id text NOT NULL,
    business_profile_id text NOT NULL,
    item_id text NOT NULL CHECK (item_id IN ('abn','gst','bank','insurance')),
    done boolean NOT NULL,
    revision integer NOT NULL CHECK (revision > 0),
    updated_by text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    done_by text,
    done_at timestamptz,
    PRIMARY KEY (org_id, business_profile_id, item_id),
    FOREIGN KEY (org_id, business_profile_id) REFERENCES business_profiles(org_id, business_profile_id),
    CHECK ((done AND done_by IS NOT NULL AND done_at IS NOT NULL) OR (NOT done AND done_by IS NULL AND done_at IS NULL))
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION preserve_profile_checklist_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.org_id, NEW.business_profile_id, NEW.item_id) IS DISTINCT FROM (OLD.org_id, OLD.business_profile_id, OLD.item_id) THEN
        RAISE EXCEPTION 'Checklist ownership is immutable';
    END IF;
    IF NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'Checklist revision must advance once'; END IF;
    RETURN NEW;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'profile_checklist_owner_immutable' AND tgrelid = 'profile_setup_checklist'::regclass) THEN
        CREATE TRIGGER profile_checklist_owner_immutable BEFORE UPDATE ON profile_setup_checklist
            FOR EACH ROW EXECUTE FUNCTION preserve_profile_checklist_owner();
    END IF;
END $$;
