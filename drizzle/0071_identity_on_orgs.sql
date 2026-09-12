-- One identity per organisation (0071): the identity lives on the organisation.
--
-- 0070 left every org with exactly one business_profiles row. This step moves
-- that row's facts onto `orgs` and re-keys the tables that carried
-- business_profile_id in their key on the organisation alone. Expand only:
-- business_profiles and every business_profile_id column stay in place,
-- unread, until the contract step (0072) drops them.
--
-- Idempotent: every column is IF NOT EXISTS, the copy only fills what the org
-- does not already hold, and each key is dropped before it is rebuilt.
--
-- 1. The identity columns. legal_name, trade_name, abn, gst_registered,
--    tax_rate and brand_color already exist on orgs.
ALTER TABLE orgs
    ADD COLUMN IF NOT EXISTS business_name text,
    ADD COLUMN IF NOT EXISTS acn text,
    ADD COLUMN IF NOT EXISTS entity_type text,
    ADD COLUMN IF NOT EXISTS tax_label text,
    ADD COLUMN IF NOT EXISTS phone text,
    ADD COLUMN IF NOT EXISTS business_email text,
    ADD COLUMN IF NOT EXISTS website text,
    ADD COLUMN IF NOT EXISTS address text,
    ADD COLUMN IF NOT EXISTS suburb text,
    ADD COLUMN IF NOT EXISTS state text,
    ADD COLUMN IF NOT EXISTS postcode text,
    ADD COLUMN IF NOT EXISTS bank_details text,
    ADD COLUMN IF NOT EXISTS representative_first_name text,
    ADD COLUMN IF NOT EXISTS representative_last_name text,
    ADD COLUMN IF NOT EXISTS representative_email text,
    ADD COLUMN IF NOT EXISTS representative_phone text,
    ADD COLUMN IF NOT EXISTS representative_address text,
    ADD COLUMN IF NOT EXISTS representative_suburb text,
    ADD COLUMN IF NOT EXISTS representative_state text,
    ADD COLUMN IF NOT EXISTS representative_postcode text,
    ADD COLUMN IF NOT EXISTS mcc text,
    ADD COLUMN IF NOT EXISTS statement_descriptor text,
    ADD COLUMN IF NOT EXISTS connect_sensitive text,
    ADD COLUMN IF NOT EXISTS connect_sensitive_forwarded_at timestamptz,
    ADD COLUMN IF NOT EXISTS logo_key text,
    ADD COLUMN IF NOT EXISTS accent_color text,
    ADD COLUMN IF NOT EXISTS template text,
    ADD COLUMN IF NOT EXISTS footer_text text,
    ADD COLUMN IF NOT EXISTS payment_instructions text,
    ADD COLUMN IF NOT EXISTS industry text,
    ADD COLUMN IF NOT EXISTS business_size text,
    ADD COLUMN IF NOT EXISTS operating_hours jsonb,
    ADD COLUMN IF NOT EXISTS about text,
    ADD COLUMN IF NOT EXISTS service_areas jsonb,
    ADD COLUMN IF NOT EXISTS target_customers jsonb,
    ADD COLUMN IF NOT EXISTS unique_selling_points jsonb,
    ADD COLUMN IF NOT EXISTS common_questions jsonb,
    ADD COLUMN IF NOT EXISTS chatbot_tone text,
    ADD COLUMN IF NOT EXISTS chatbot_instructions text,
    ADD COLUMN IF NOT EXISTS google_review_url text,
    ADD COLUMN IF NOT EXISTS setup_completed_at timestamptz,
    ADD COLUMN IF NOT EXISTS setup_modal_seen_at timestamptz;
--> statement-breakpoint
-- 2. Copy the canonical profile onto its organisation. The profile has been
--    the authoritative home for these facts since 0015, so where it holds a
--    value it wins; where it is empty the org's own column stands.
UPDATE orgs o SET
    business_name = COALESCE(p.business_name, o.business_name),
    legal_name = COALESCE(p.legal_name, o.legal_name),
    trade_name = COALESCE(p.trade_name, o.trade_name),
    abn = COALESCE(p.abn, o.abn),
    acn = COALESCE(p.acn, o.acn),
    entity_type = COALESCE(p.entity_type, o.entity_type),
    gst_registered = COALESCE(p.gst_registered, o.gst_registered),
    tax_rate = COALESCE(p.tax_rate, o.tax_rate),
    tax_label = COALESCE(p.tax_label, o.tax_label),
    phone = COALESCE(p.phone, o.phone),
    business_email = COALESCE(p.business_email, o.business_email),
    website = COALESCE(p.website, o.website),
    address = COALESCE(p.address, o.address),
    suburb = COALESCE(p.suburb, o.suburb),
    state = COALESCE(p.state, o.state),
    postcode = COALESCE(p.postcode, o.postcode),
    bank_details = COALESCE(p.bank_details, o.bank_details),
    representative_first_name = COALESCE(p.representative_first_name, o.representative_first_name),
    representative_last_name = COALESCE(p.representative_last_name, o.representative_last_name),
    representative_email = COALESCE(p.representative_email, o.representative_email),
    representative_phone = COALESCE(p.representative_phone, o.representative_phone),
    representative_address = COALESCE(p.representative_address, o.representative_address),
    representative_suburb = COALESCE(p.representative_suburb, o.representative_suburb),
    representative_state = COALESCE(p.representative_state, o.representative_state),
    representative_postcode = COALESCE(p.representative_postcode, o.representative_postcode),
    mcc = COALESCE(p.mcc, o.mcc),
    statement_descriptor = COALESCE(p.statement_descriptor, o.statement_descriptor),
    connect_sensitive = COALESCE(p.connect_sensitive, o.connect_sensitive),
    connect_sensitive_forwarded_at = COALESCE(p.connect_sensitive_forwarded_at, o.connect_sensitive_forwarded_at),
    logo_key = COALESCE(p.logo_key, o.logo_key),
    brand_color = COALESCE(p.brand_color, o.brand_color),
    accent_color = COALESCE(p.accent_color, o.accent_color),
    template = COALESCE(p.template, o.template),
    footer_text = COALESCE(p.footer_text, o.footer_text),
    payment_instructions = COALESCE(p.payment_instructions, o.payment_instructions),
    industry = COALESCE(p.industry, o.industry),
    business_size = COALESCE(p.business_size, o.business_size),
    operating_hours = COALESCE(p.operating_hours, o.operating_hours),
    about = COALESCE(p.about, o.about),
    service_areas = COALESCE(p.service_areas, o.service_areas),
    target_customers = COALESCE(p.target_customers, o.target_customers),
    unique_selling_points = COALESCE(p.unique_selling_points, o.unique_selling_points),
    common_questions = COALESCE(p.common_questions, o.common_questions),
    chatbot_tone = COALESCE(p.chatbot_tone, o.chatbot_tone),
    chatbot_instructions = COALESCE(p.chatbot_instructions, o.chatbot_instructions),
    google_review_url = COALESCE(p.google_review_url, o.google_review_url),
    setup_completed_at = COALESCE(p.setup_completed_at, o.setup_completed_at),
    setup_modal_seen_at = COALESCE(p.setup_modal_seen_at, o.setup_modal_seen_at)
FROM business_profiles p
WHERE p.org_id = o.org_id
  AND p.business_profile_id = o.business_profile_id;
--> statement-breakpoint
-- 3. Tables that keyed on the profile key on the organisation. 0070 already
--    removed every row that would collide; the profile column is left in
--    place, nullable, for 0072. (A column still in a key cannot lose NOT NULL,
--    so the key goes first.)
ALTER TABLE inbound_mailboxes DROP CONSTRAINT IF EXISTS inbound_mailboxes_pkey;
--> statement-breakpoint
ALTER TABLE inbound_mailboxes ADD PRIMARY KEY (org_id);
--> statement-breakpoint
ALTER TABLE inbound_mailboxes ALTER COLUMN business_profile_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE email_conversations DROP CONSTRAINT IF EXISTS email_conversations_pkey;
--> statement-breakpoint
ALTER TABLE email_conversations ADD PRIMARY KEY (org_id, conversation_id);
--> statement-breakpoint
ALTER TABLE email_conversations ALTER COLUMN business_profile_id DROP NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS email_conversations_invoice_idx;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS email_conversations_invoice_idx ON email_conversations (org_id, invoice_id);
--> statement-breakpoint
ALTER TABLE inbound_messages DROP CONSTRAINT IF EXISTS inbound_messages_pkey;
--> statement-breakpoint
ALTER TABLE inbound_messages ADD PRIMARY KEY (org_id, message_id);
--> statement-breakpoint
ALTER TABLE inbound_messages ALTER COLUMN business_profile_id DROP NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS inbound_messages_profile_received_idx;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inbound_messages_org_received_idx ON inbound_messages (org_id, received_at, message_id);
--> statement-breakpoint
ALTER TABLE email_delivery_claims DROP CONSTRAINT IF EXISTS email_delivery_claims_pkey;
--> statement-breakpoint
ALTER TABLE email_delivery_claims ADD PRIMARY KEY (org_id, delivery_id);
--> statement-breakpoint
ALTER TABLE email_delivery_claims ALTER COLUMN business_profile_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE email_conversation_invoices DROP CONSTRAINT IF EXISTS email_conversation_invoices_pkey;
--> statement-breakpoint
ALTER TABLE email_conversation_invoices ADD PRIMARY KEY (org_id, conversation_id, invoice_id);
--> statement-breakpoint
ALTER TABLE email_conversation_invoices ALTER COLUMN business_profile_id DROP NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS email_conversation_invoices_invoice_idx;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS email_conversation_invoices_invoice_idx ON email_conversation_invoices (org_id, invoice_id);
--> statement-breakpoint
ALTER TABLE invoice_chase_actions ALTER COLUMN business_profile_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE sms_response_links ALTER COLUMN business_profile_id DROP NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS sms_response_profile_idx;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sms_response_org_idx ON sms_response_links (org_id);
--> statement-breakpoint
DROP INDEX IF EXISTS sms_response_origin_uq;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sms_response_origin_uq ON sms_response_links (org_id, (context->>'source'), (context->>'originId'));
--> statement-breakpoint
ALTER TABLE invoice_response_delivery_claims DROP CONSTRAINT IF EXISTS invoice_response_delivery_claims_pkey;
--> statement-breakpoint
ALTER TABLE invoice_response_delivery_claims ADD PRIMARY KEY (org_id, delivery_id);
--> statement-breakpoint
ALTER TABLE invoice_response_delivery_claims ALTER COLUMN business_profile_id DROP NOT NULL;
