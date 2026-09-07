ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS signature_method text CHECK (signature_method IN ('digital', 'wet'));
--> statement-breakpoint
ALTER TABLE envelope_recipients ADD COLUMN IF NOT EXISTS signing_capacity text CHECK (signing_capacity IN ('principal', 'witness'));
--> statement-breakpoint
ALTER TABLE envelope_signatures ADD COLUMN IF NOT EXISTS signed_copy_key text;
--> statement-breakpoint
ALTER TABLE envelope_signatures ADD COLUMN IF NOT EXISTS signed_copy_sha256 text;
--> statement-breakpoint
ALTER TABLE envelope_recipients ADD COLUMN IF NOT EXISTS role_label text;
--> statement-breakpoint
ALTER TABLE envelope_templates ADD COLUMN IF NOT EXISTS signature_method text CHECK (signature_method IN ('digital', 'wet'));
--> statement-breakpoint
ALTER TABLE envelope_template_roles ADD COLUMN IF NOT EXISTS signing_capacity text CHECK (signing_capacity IN ('principal', 'witness'));
