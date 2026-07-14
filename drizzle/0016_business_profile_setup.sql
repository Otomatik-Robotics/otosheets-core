-- Account-setup completion stamp — set once when setup first reaches 100%
-- (see BusinessProfileStoredSchema.setupCompletedAt). Additive + idempotent.
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS setup_completed_at timestamptz;
