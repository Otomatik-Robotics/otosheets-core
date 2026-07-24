-- Payer → client aliases (0034). Org-scoped map from a normalised bank-descriptor
-- payer key (normaliseMerchant() output) to a CRM client, so an income credit whose
-- payer is a known client is confidently attributed (and, for a GST-registered
-- business, treated as GST-inclusive). Mirrors the merchant-category cache shape
-- but is org-scoped: a client belongs to exactly one org. Postgres-only (reporting/
-- join entity — no DynamoDB mirror).
CREATE TABLE IF NOT EXISTS payer_aliases (
    org_id text NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    payer_key text NOT NULL,                 -- normaliseMerchant(description) output
    client_id text NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
    created_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, payer_key)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS payer_aliases_client_idx ON payer_aliases (client_id);
