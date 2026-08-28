-- Forms (0041): per-form branding — logo + primary/secondary colours, jsonb.
-- Nullable/additive (expand-contract): unset values inherit the org's brand.
ALTER TABLE forms ADD COLUMN IF NOT EXISTS brand jsonb;
