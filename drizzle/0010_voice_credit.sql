-- Voice-credit wallet + ledger (§4). Wallet balance maintained by atomic
-- increments in the same tx that inserts the deterministic ledger entry.
CREATE TABLE IF NOT EXISTS voice_credit_wallets (
    org_id TEXT PRIMARY KEY REFERENCES orgs(org_id) ON DELETE CASCADE,
    balance_cents BIGINT NOT NULL DEFAULT 0,
    currency TEXT,
    updated_at TEXT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS voice_credit_ledger (
    org_id TEXT NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL,
    type TEXT,
    amount_cents BIGINT,
    call_id TEXT,
    stripe_session_id TEXT,
    period TEXT,
    description TEXT,
    created_at TEXT,
    PRIMARY KEY (org_id, entry_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS voice_credit_ledger_org_created_idx ON voice_credit_ledger (org_id, created_at);
