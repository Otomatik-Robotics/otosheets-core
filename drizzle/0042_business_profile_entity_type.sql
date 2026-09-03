-- Business profile (0042): legal entity type (sole trader, company, partnership,
-- trust, ...). Free text, not an enum, so the set can grow without a migration.
--
-- Additive and nullable (expand-contract): every existing profile predates the
-- question and reads back as NULL, which is the truth for all of them.
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS entity_type text;
