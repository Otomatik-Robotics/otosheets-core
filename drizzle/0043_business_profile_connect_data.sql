-- Business profile (0043): Stripe Connect onboarding data. Otosheets collects
-- the full set Stripe Express asks an Australian connected account for
-- (representative, merchant category, statement descriptor, and the
-- sensitive DOB + bank details) so Stripe can be prefilled and the owner
-- only confirms.
--
-- connect_sensitive is CIPHERTEXT ONLY by contract: the backend encrypts the
-- JSON blob { dob, bank } with its org-keyed seam before any write, and clears
-- it once forwarded to Stripe. connect_sensitive_forwarded_at remains as the
-- audit stamp after the blob is deleted.
--
-- Additive and nullable (expand-contract): every existing profile predates
-- these questions and reads back as NULL.
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS representative_first_name text;
--> statement-breakpoint
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS representative_last_name text;
--> statement-breakpoint
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS representative_email text;
--> statement-breakpoint
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS representative_phone text;
--> statement-breakpoint
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS representative_address text;
--> statement-breakpoint
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS representative_suburb text;
--> statement-breakpoint
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS representative_state text;
--> statement-breakpoint
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS representative_postcode text;
--> statement-breakpoint
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS mcc text;
--> statement-breakpoint
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS statement_descriptor text;
--> statement-breakpoint
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS connect_sensitive text;
--> statement-breakpoint
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS connect_sensitive_forwarded_at timestamptz;
