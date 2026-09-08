CREATE TABLE IF NOT EXISTS email_conversation_invoices (
 org_id text NOT NULL, business_profile_id text NOT NULL, conversation_id text NOT NULL, invoice_id text NOT NULL,
 PRIMARY KEY (org_id, business_profile_id, conversation_id, invoice_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS email_conversation_invoices_invoice_idx ON email_conversation_invoices (org_id, business_profile_id, invoice_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS invoice_chase_actions (
 org_id text NOT NULL, business_profile_id text NOT NULL, action_id text NOT NULL, invoice_id text NOT NULL,
 PRIMARY KEY (org_id, action_id)
);
