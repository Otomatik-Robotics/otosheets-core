CREATE TABLE IF NOT EXISTS sms_response_links (
  token_hash text PRIMARY KEY, org_id text NOT NULL, business_profile_id text NOT NULL,
  context jsonb NOT NULL, phone_hash text NOT NULL, created_at text NOT NULL, expires_at text NOT NULL,
  revoked_at text, provider_message_id text, delivery_state text NOT NULL,
  attempts integer NOT NULL, last_attempt_at text,
  processing_id text, processing_until text, retry_at text, processing_attempts integer NOT NULL,
  response_phone text, response_id text, response_text text, received_at text, published_at text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sms_response_profile_idx ON sms_response_links (org_id, business_profile_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sms_response_pending_idx ON sms_response_links (published_at, received_at);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS invoice_response_delivery_claims (
  org_id text NOT NULL, business_profile_id text NOT NULL, delivery_id text NOT NULL,
  invoice_id text NOT NULL, claimed_at text NOT NULL,
  PRIMARY KEY (org_id, business_profile_id, delivery_id)
);
