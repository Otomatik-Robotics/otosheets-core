-- DynamoDB stores top-level gstRegistered sparsely (it's vestigial — the real
-- flag lives in bookingSettings.businessProfile). NOT NULL DEFAULT false
-- materializes a value Dynamo doesn't have, producing perpetual shadow-read
-- diffs during the dual-state soak (found by the dev smoke test, 2026-07-04).
-- Make it nullable, drop the default, and clear values that were only the
-- materialized default so pg faithfully mirrors Dynamo's absence.
ALTER TABLE orgs ALTER COLUMN gst_registered DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE orgs ALTER COLUMN gst_registered DROP NOT NULL;
--> statement-breakpoint
-- Safe here because no dev org carries a genuine top-level gstRegistered; if a
-- later environment does, re-backfill overwrites the correct rows afterwards.
UPDATE orgs SET gst_registered = NULL WHERE gst_registered = false;
