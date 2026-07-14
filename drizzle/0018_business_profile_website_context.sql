-- Website-builder / AI-knowledge context on the business profile
-- (industry, business size, per-day operating hours). Additive + idempotent.
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS industry text;--> statement-breakpoint
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS business_size text;--> statement-breakpoint
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS operating_hours jsonb;
