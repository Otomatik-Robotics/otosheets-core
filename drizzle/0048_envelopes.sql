-- Documents / envelopes (0048): the e-signature spine.
--
-- Postgres-only, no DynamoDB mirror. Named envelope_* rather than document_*
-- because a `documents` concept already ships on DynamoDB (DocumentRepo, the
-- /documents route, DOCUMENT endpoint keys); two entities called Document in
-- one codebase is how the wrong repo gets imported.
--
-- Four constraints in here are load-bearing and are the reason this migration
-- lands before any envelope exists in any environment:
--   envelope_events   UNIQUE (envelope_id, seq)          -- the chain cannot fork
--   envelope_artifacts UNIQUE (envelope_id, kind)        -- a document is sealed once
--   envelope_signatures UNIQUE (version_id, recipient_id) -- signing is idempotent
--   signatures hang off a VERSION                        -- an accepted edit voids, never inherits
--
-- Retrofitting any of them is a migration over evidence: a hash chain cannot be
-- recomputed for events whose canonical bytes were never recorded.
CREATE TABLE IF NOT EXISTS envelopes (
    envelope_id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    business_profile_id text,
    created_by text NOT NULL,
    title text NOT NULL,
    kind text NOT NULL,
    tier integer NOT NULL,
    status text NOT NULL,
    current_version_no integer NOT NULL DEFAULT 1,
    hold_signers_for_review boolean NOT NULL DEFAULT true,
    completed_at text,
    voided_at text,
    voided_reason text,
    created_at text NOT NULL,
    updated_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS envelopes_org_created_idx ON envelopes (org_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS envelopes_org_status_idx ON envelopes (org_id, status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS envelope_versions (
    version_id text PRIMARY KEY,
    envelope_id text NOT NULL REFERENCES envelopes(envelope_id) ON DELETE CASCADE,
    version_no integer NOT NULL,
    body_markdown text,
    s3_key text,
    sha256 text,
    created_by text NOT NULL,
    created_reason text,
    superseded_at text,
    created_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS envelope_versions_env_no_uq ON envelope_versions (envelope_id, version_no);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS envelope_recipients (
    recipient_id text PRIMARY KEY,
    envelope_id text NOT NULL REFERENCES envelopes(envelope_id) ON DELETE CASCADE,
    role text NOT NULL,
    order_no integer NOT NULL DEFAULT 0,
    name text,
    email text NOT NULL,
    token_hash text,
    expires_at text,
    revoked_at text,
    revoked_reason text,
    access_code_hash text,
    access_code_salt text,
    access_code_params jsonb,
    access_code_channel text,
    failed_attempts integer NOT NULL DEFAULT 0,
    locked_until text,
    status text NOT NULL,
    dispatched_at text,
    first_opened_at text,
    completed_at text,
    ses_message_id text,
    bounced_at text,
    bounce_type text,
    bounce_reason text,
    verdict text,
    verdict_at text,
    verdict_note text,
    created_at text NOT NULL,
    updated_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS envelope_recipients_env_idx ON envelope_recipients (envelope_id);
--> statement-breakpoint
-- Partial rather than plain. Postgres already allows repeated NULLs in a unique
-- index, so this is not correcting a collision; it states the intent, which is
-- that the constraint governs issued tokens only. A recipient who has not been
-- dispatched yet has no token and is outside it.
CREATE UNIQUE INDEX IF NOT EXISTS envelope_recipients_token_uq ON envelope_recipients (token_hash) WHERE token_hash IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS envelope_recipients_msgid_idx ON envelope_recipients (ses_message_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS envelope_fields (
    field_id text PRIMARY KEY,
    version_id text NOT NULL REFERENCES envelope_versions(version_id) ON DELETE CASCADE,
    recipient_id text REFERENCES envelope_recipients(recipient_id) ON DELETE CASCADE,
    type text NOT NULL,
    label text,
    required boolean NOT NULL DEFAULT true,
    page integer NOT NULL,
    x text NOT NULL,
    y text NOT NULL,
    w text NOT NULL,
    h text NOT NULL,
    value text,
    filled_at text,
    created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS envelope_fields_version_idx ON envelope_fields (version_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS envelope_fields_recipient_idx ON envelope_fields (recipient_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS envelope_signatures (
    signature_id text PRIMARY KEY,
    version_id text NOT NULL REFERENCES envelope_versions(version_id) ON DELETE CASCADE,
    recipient_id text NOT NULL REFERENCES envelope_recipients(recipient_id) ON DELETE CASCADE,
    typed_name text,
    signature_image_key text,
    signed_at text NOT NULL,
    ip text,
    user_agent text,
    voided_at text,
    voided_reason text
);
--> statement-breakpoint
-- The idempotency wall. A replayed sign loses this insert and returns the prior
-- result rather than appending a second chain entry and re-sending the email.
CREATE UNIQUE INDEX IF NOT EXISTS envelope_signatures_version_recipient_uq ON envelope_signatures (version_id, recipient_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS envelope_events (
    event_id text PRIMARY KEY,
    envelope_id text NOT NULL REFERENCES envelopes(envelope_id) ON DELETE CASCADE,
    seq integer NOT NULL,
    type text NOT NULL,
    actor_type text NOT NULL,
    actor_id text,
    actor_label text,
    version_id text,
    recipient_id text,
    detail jsonb,
    ip text,
    user_agent text,
    canonical text NOT NULL,
    prev_hash text,
    hash text NOT NULL,
    created_at text NOT NULL
);
--> statement-breakpoint
-- The chain cannot fork: two concurrent appends cannot both take a position.
CREATE UNIQUE INDEX IF NOT EXISTS envelope_events_env_seq_uq ON envelope_events (envelope_id, seq);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS envelope_events_env_created_idx ON envelope_events (envelope_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS envelope_artifacts (
    artifact_id text PRIMARY KEY,
    envelope_id text NOT NULL REFERENCES envelopes(envelope_id) ON DELETE CASCADE,
    version_id text,
    kind text NOT NULL,
    s3_key text NOT NULL,
    sha256 text NOT NULL,
    byte_size integer NOT NULL,
    created_at text NOT NULL
);
--> statement-breakpoint
-- Sealed once. Regenerating produces different bytes for the same events.
CREATE UNIQUE INDEX IF NOT EXISTS envelope_artifacts_env_kind_uq ON envelope_artifacts (envelope_id, kind);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS envelope_comments (
    comment_id text PRIMARY KEY,
    envelope_id text NOT NULL REFERENCES envelopes(envelope_id) ON DELETE CASCADE,
    version_id text NOT NULL,
    recipient_id text,
    author_label text NOT NULL,
    page integer,
    x text,
    y text,
    anchor_quote text,
    body text NOT NULL,
    proposed_text text,
    resolved_at text,
    created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS envelope_comments_version_idx ON envelope_comments (version_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS envelope_comments_env_created_idx ON envelope_comments (envelope_id, created_at);
