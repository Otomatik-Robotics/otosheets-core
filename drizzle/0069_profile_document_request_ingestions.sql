-- Source-only expansion after0068. No financial route, job or fulfillment is enabled.
CREATE UNIQUE INDEX IF NOT EXISTS profile_docrequest_parent_kind_owner ON profile_document_requests (request_id,org_id,business_profile_id,advisor_user_id,doc_type);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS profile_docrequest_attachment_owner ON profile_document_request_attachments (file_id,request_id,org_id,business_profile_id,advisor_user_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS profile_document_request_ingestions (
    file_id text PRIMARY KEY,
    request_id text NOT NULL, org_id text NOT NULL, business_profile_id text NOT NULL, advisor_user_id text NOT NULL,
    doc_type text NOT NULL CHECK (doc_type IN ('BANK_STATEMENT','EXPENSE_DOC')),
    target_id text NOT NULL UNIQUE, target_user_id text NOT NULL, financial_year text,
    admitted_by text NOT NULL, admitted_revision integer NOT NULL CHECK (admitted_revision > 0),
    status text NOT NULL DEFAULT 'RESERVED' CHECK (status = 'RESERVED'),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (file_id,request_id,org_id,business_profile_id,advisor_user_id)
        REFERENCES profile_document_request_attachments (file_id,request_id,org_id,business_profile_id,advisor_user_id),
    FOREIGN KEY (request_id,org_id,business_profile_id,advisor_user_id,doc_type)
        REFERENCES profile_document_requests (request_id,org_id,business_profile_id,advisor_user_id,doc_type),
    CHECK ((doc_type='BANK_STATEMENT' AND target_id ~ '^dsi_[a-f0-9]{64}$' AND financial_year IS NOT NULL
                AND financial_year ~ '^[0-9]{4}-[0-9]{2}$'
                AND substring(financial_year,6,2)::integer = (substring(financial_year,1,4)::integer+1)%100)
        OR (doc_type='EXPENSE_DOC' AND target_id ~ '^dri_[a-f0-9]{64}$' AND financial_year IS NULL))
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION preserve_profile_docrequest_ingestion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Document request ingestion admission is immutable'; END $$;
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='profile_docrequest_ingestion_immutable' AND tgrelid='profile_document_request_ingestions'::regclass) THEN
        CREATE TRIGGER profile_docrequest_ingestion_immutable BEFORE UPDATE OR DELETE ON profile_document_request_ingestions FOR EACH ROW EXECUTE FUNCTION preserve_profile_docrequest_ingestion();
    END IF;
END $$;
