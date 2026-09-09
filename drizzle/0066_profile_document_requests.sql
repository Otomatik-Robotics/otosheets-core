-- Source-only expansion after0065; before any DOCREQ model reader. No legacy import.
CREATE TABLE IF NOT EXISTS profile_document_requests (
    request_id text PRIMARY KEY CHECK (request_id ~ '^dr_[a-f0-9]{64}$'),
    org_id text NOT NULL, business_profile_id text NOT NULL, advisor_user_id text NOT NULL,
    client_request_key text NOT NULL, payload_fingerprint text NOT NULL,
    title text NOT NULL, description text NOT NULL, due_date text NOT NULL,
    doc_type text NOT NULL CHECK (doc_type IN ('GENERAL','BANK_STATEMENT','EXPENSE_DOC')),
    status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CANCELLED')),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
    FOREIGN KEY (org_id,business_profile_id) REFERENCES business_profiles(org_id,business_profile_id),
    UNIQUE (org_id,business_profile_id,advisor_user_id,client_request_key),
    UNIQUE (request_id,org_id,business_profile_id,advisor_user_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS profile_document_requests_page ON profile_document_requests (org_id,business_profile_id,advisor_user_id,request_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS profile_document_request_files (
    file_id text PRIMARY KEY CHECK (file_id ~ '^df_[a-f0-9]{64}$'),
    request_id text NOT NULL, org_id text NOT NULL, business_profile_id text NOT NULL, advisor_user_id text NOT NULL,
    uploaded_by text NOT NULL, client_file_key text NOT NULL, payload_fingerprint text NOT NULL,
    file_name text NOT NULL, content_type text NOT NULL, extension text NOT NULL,
    size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 26214400),
    sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'), file_key text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'RESERVED' CHECK (status = 'RESERVED'), created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (request_id,org_id,business_profile_id,advisor_user_id) REFERENCES profile_document_requests(request_id,org_id,business_profile_id,advisor_user_id),
    UNIQUE (request_id,uploaded_by,client_file_key),
    CHECK (file_key = 'doc-requests/' || org_id || '/profiles/' || business_profile_id || '/' || request_id || '/' || file_id || '.' || extension),
    CHECK ((content_type,extension) IN (('image/jpeg','jpg'),('image/png','png'),('application/pdf','pdf'),
        ('application/vnd.openxmlformats-officedocument.wordprocessingml.document','docx'),
        ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','xlsx'),('text/csv','csv')))
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION preserve_profile_docrequest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.request_id,NEW.org_id,NEW.business_profile_id,NEW.advisor_user_id,NEW.client_request_key,NEW.payload_fingerprint,NEW.title,NEW.description,NEW.due_date,NEW.doc_type,NEW.created_at)
        IS DISTINCT FROM (OLD.request_id,OLD.org_id,OLD.business_profile_id,OLD.advisor_user_id,OLD.client_request_key,OLD.payload_fingerprint,OLD.title,OLD.description,OLD.due_date,OLD.doc_type,OLD.created_at) THEN
        RAISE EXCEPTION 'Document request ownership and payload are immutable';
    END IF;
    IF OLD.status <> 'OPEN' OR NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'Document request changed or closed'; END IF;
    RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION preserve_profile_docrequest_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Document request reservation is immutable';
END $$;
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='profile_docrequest_immutable' AND tgrelid='profile_document_requests'::regclass) THEN
        CREATE TRIGGER profile_docrequest_immutable BEFORE UPDATE ON profile_document_requests FOR EACH ROW EXECUTE FUNCTION preserve_profile_docrequest();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='profile_docrequest_file_immutable' AND tgrelid='profile_document_request_files'::regclass) THEN
        CREATE TRIGGER profile_docrequest_file_immutable BEFORE UPDATE ON profile_document_request_files FOR EACH ROW EXECUTE FUNCTION preserve_profile_docrequest_file();
    END IF;
END $$;
