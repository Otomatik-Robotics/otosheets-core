-- Expand only: no legacy alias copy or ownership inference. Run before scoped readers.
CREATE TABLE IF NOT EXISTS profile_payer_aliases (
    org_id text NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    business_profile_id text NOT NULL REFERENCES business_profiles(business_profile_id) ON DELETE CASCADE,
    payer_key text NOT NULL,
    client_id text NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
    created_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, business_profile_id, payer_key)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS profile_payer_aliases_client_idx ON profile_payer_aliases (client_id);
