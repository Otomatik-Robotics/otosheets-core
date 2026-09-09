-- Source only after0067; before GENERAL fulfillment callers. No data import.
DO $$ BEGIN
    ALTER TABLE profile_document_requests DROP CONSTRAINT IF EXISTS profile_document_requests_status_check;
    ALTER TABLE profile_document_requests ADD CONSTRAINT profile_document_requests_status_check CHECK (status IN ('OPEN','FULFILLED','CANCELLED'));
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profile_docrequest_general_fulfillment' AND conrelid='profile_document_requests'::regclass) THEN
        ALTER TABLE profile_document_requests ADD CONSTRAINT profile_docrequest_general_fulfillment CHECK (status<>'FULFILLED' OR doc_type='GENERAL');
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION preserve_profile_docrequest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.request_id,NEW.org_id,NEW.business_profile_id,NEW.advisor_user_id,NEW.client_request_key,NEW.payload_fingerprint,NEW.title,NEW.description,NEW.due_date,NEW.doc_type,NEW.created_at)
        IS DISTINCT FROM (OLD.request_id,OLD.org_id,OLD.business_profile_id,OLD.advisor_user_id,OLD.client_request_key,OLD.payload_fingerprint,OLD.title,OLD.description,OLD.due_date,OLD.doc_type,OLD.created_at) THEN
        RAISE EXCEPTION 'Document request ownership and payload are immutable';
    END IF;
    IF OLD.status <> 'OPEN' OR NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'Document request changed or closed'; END IF;
    IF NEW.status = 'FULFILLED' AND (NEW.doc_type <> 'GENERAL' OR NOT EXISTS (SELECT 1 FROM profile_document_request_attachments WHERE request_id=NEW.request_id)) THEN
        RAISE EXCEPTION 'General fulfillment requires a verified attachment';
    END IF;
    RETURN NEW;
END $$;
