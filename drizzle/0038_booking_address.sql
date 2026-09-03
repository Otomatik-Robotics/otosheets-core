-- Bookings get a real address, and both bookings and jobs get an explicit
-- record of what the address lookup concluded.
--
-- Until now a booking's entire location record was `suburb` — free text, model-
-- supplied on every agent path (phone, website chat, DM), never checked against
-- anything. Meanwhile jobs DID geocode, but stored only the coordinates: a
-- lookup that failed, or matched the wrong street with low confidence, was
-- indistinguishable from one that never ran. `address_status` makes the outcome
-- data instead of a log line, so the UI can say "verified" or "we could not
-- find this" and the geofence stops silently not firing.
--
-- Additive and nullable throughout — every existing row keeps working and reads
-- back as "never looked up" (NULL), which is the truth for all of them.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS address text;
--> statement-breakpoint
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS lat double precision;
--> statement-breakpoint
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS lng double precision;
--> statement-breakpoint
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS address_status text;
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS address_status text;
--> statement-breakpoint
-- "Which of my upcoming jobs has an address we could not confirm?" is the query
-- the ops view runs; partial so the index only carries the rows worth chasing.
CREATE INDEX IF NOT EXISTS jobs_address_unresolved_idx ON jobs (org_id, scheduled_date)
    WHERE address_status IN ('not_found', 'lookup_failed');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bookings_address_unresolved_idx ON bookings (org_id, booking_date)
    WHERE address_status IN ('not_found', 'lookup_failed');
