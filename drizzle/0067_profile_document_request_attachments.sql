-- Source-only; after0066, before attachment readers. No legacy import or backfill.
CREATE UNIQUE INDEX IF NOT EXISTS profile_docrequest_files_owner ON profile_document_request_files (file_id,request_id,org_id,business_profile_id,advisor_user_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS profile_document_request_attachments (
    file_id text PRIMARY KEY, request_id text NOT NULL, org_id text NOT NULL, business_profile_id text NOT NULL, advisor_user_id text NOT NULL,
    bucket_name text NOT NULL, file_key text NOT NULL, version_id text NOT NULL CHECK (version_id <> '' AND version_id <> 'null'),
    sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'), size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 26214400),
    attached_by text NOT NULL, attached_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (file_id,request_id,org_id,business_profile_id,advisor_user_id) REFERENCES profile_document_request_files (file_id,request_id,org_id,business_profile_id,advisor_user_id)
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION preserve_profile_docrequest_attachment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Document request attachment is immutable'; END $$;
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='profile_docrequest_attachment_immutable' AND tgrelid='profile_document_request_attachments'::regclass) THEN
        CREATE TRIGGER profile_docrequest_attachment_immutable BEFORE UPDATE ON profile_document_request_attachments FOR EACH ROW EXECUTE FUNCTION preserve_profile_docrequest_attachment();
    END IF;
END $$;
