-- Expand only. Required before signature-request readers. No legacy SIGREQ import.
CREATE UNIQUE INDEX IF NOT EXISTS business_profiles_org_profile_uq
    ON business_profiles (org_id, business_profile_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS profile_signature_requests (
    request_id text PRIMARY KEY,
    org_id text NOT NULL,
    business_profile_id text NOT NULL,
    advisor_user_id text NOT NULL,
    client_request_key text NOT NULL,
    payload_fingerprint text NOT NULL,
    title text NOT NULL,
    signer_email text NOT NULL,
    signer_name text NOT NULL,
    message text NOT NULL,
    kind text NOT NULL,
    provider text NOT NULL CHECK (provider = 'otosheets'),
    document_key text,
    status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SENDING','SENT','CANCELLING','CANCELLED')),
    attempt_id text,
    provider_ref text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (org_id, business_profile_id) REFERENCES business_profiles(org_id, business_profile_id),
    CONSTRAINT profile_signature_requests_identity_uq UNIQUE (org_id, business_profile_id, advisor_user_id, client_request_key),
    CHECK (request_id ~ '^sr_[a-f0-9]{64}$'),
    CHECK (document_key IS NULL OR document_key IN (
        'documents/' || org_id || '/profiles/' || business_profile_id || '/originals/' || request_id || '.pdf',
        'documents/' || org_id || '/profiles/' || business_profile_id || '/originals/' || request_id || '.docx')),
    CHECK (status = 'DRAFT' OR attempt_id IS NOT NULL),
    CHECK (status NOT IN ('SENDING','SENT','CANCELLING') OR document_key IS NOT NULL),
    CHECK (status <> 'SENT' OR provider_ref IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS profile_signature_requests_scope_idx
    ON profile_signature_requests (org_id, business_profile_id, advisor_user_id, request_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION preserve_signature_request_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.request_id, NEW.org_id, NEW.business_profile_id, NEW.advisor_user_id,
        NEW.client_request_key, NEW.payload_fingerprint, NEW.title, NEW.signer_email,
        NEW.signer_name, NEW.message, NEW.kind, NEW.provider)
       IS DISTINCT FROM
       (OLD.request_id, OLD.org_id, OLD.business_profile_id, OLD.advisor_user_id,
        OLD.client_request_key, OLD.payload_fingerprint, OLD.title, OLD.signer_email,
        OLD.signer_name, OLD.message, OLD.kind, OLD.provider) THEN
        RAISE EXCEPTION 'Signature request identity is immutable';
    END IF;
    IF OLD.document_key IS NOT NULL AND NEW.document_key IS DISTINCT FROM OLD.document_key THEN
        RAISE EXCEPTION 'Signature request file reservation is immutable';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
        (OLD.status = 'DRAFT' AND NEW.status IN ('SENDING','CANCELLED')) OR
        (OLD.status = 'SENDING' AND NEW.status = 'SENT') OR
        (OLD.status = 'SENT' AND NEW.status = 'CANCELLING') OR
        (OLD.status = 'CANCELLING' AND NEW.status = 'CANCELLED')) THEN
        RAISE EXCEPTION 'Invalid signature request transition';
    END IF;
    IF OLD.status IN ('SENDING','CANCELLING','CANCELLED') AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id THEN
        RAISE EXCEPTION 'Signature request attempt is immutable';
    END IF;
    RETURN NEW;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'signature_request_identity_immutable'
        AND tgrelid = 'profile_signature_requests'::regclass) THEN
        CREATE TRIGGER signature_request_identity_immutable BEFORE UPDATE ON profile_signature_requests
            FOR EACH ROW EXECUTE FUNCTION preserve_signature_request_identity();
    END IF;
END $$;
