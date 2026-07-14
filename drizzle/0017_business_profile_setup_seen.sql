-- First-login setup-modal stamp — set once when the setup overview modal
-- first auto-opens (see BusinessProfileStoredSchema.setupModalSeenAt).
-- Additive + idempotent.
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS setup_modal_seen_at timestamptz;
