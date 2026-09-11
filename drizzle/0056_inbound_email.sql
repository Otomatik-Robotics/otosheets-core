CREATE TABLE IF NOT EXISTS inbound_mailboxes (
 org_id text NOT NULL, business_profile_id text NOT NULL, address text NOT NULL,
 created_at text NOT NULL, PRIMARY KEY (org_id, business_profile_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS inbound_mailboxes_address_uq ON inbound_mailboxes (address);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS email_conversations (
 org_id text NOT NULL, business_profile_id text NOT NULL, conversation_id text NOT NULL,
 reply_address text NOT NULL, invoice_id text, customer_email text NOT NULL,
 paused_at text, created_at text NOT NULL, PRIMARY KEY (org_id, business_profile_id, conversation_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS email_conversations_reply_uq ON email_conversations (reply_address);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS email_conversations_invoice_idx ON email_conversations (org_id, business_profile_id, invoice_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS inbound_messages (
 org_id text NOT NULL, business_profile_id text NOT NULL, message_id text NOT NULL,
 conversation_id text NOT NULL, received_at text NOT NULL, content jsonb NOT NULL,
 published_at text, PRIMARY KEY (org_id, business_profile_id, message_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inbound_messages_profile_received_idx ON inbound_messages (org_id, business_profile_id, received_at, message_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS email_delivery_claims (
 org_id text NOT NULL, business_profile_id text NOT NULL, delivery_id text NOT NULL,
 conversation_id text NOT NULL, claimed_at text NOT NULL, provider_message_id text,
 PRIMARY KEY (org_id, business_profile_id, delivery_id)
);
