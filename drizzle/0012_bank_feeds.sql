-- Bank-feed domain (open banking via Fiskil / CDR) — born in Postgres, no Dynamo
-- counterpart, no cutover flag. Live-feed sibling of the statements domain: money is
-- INTEGER CENTS (BIGINT), and the categorisation columns mirror statement_transactions
-- so reporting can UNION the two sources. Additive + idempotent per expand-contract.

CREATE TABLE IF NOT EXISTS bank_accounts (
    account_id             TEXT PRIMARY KEY,
    user_id                TEXT NOT NULL,
    organization_id        TEXT,
    provider               TEXT NOT NULL DEFAULT 'fiskil',
    consent_id             TEXT,
    institution_id         TEXT,
    institution_name       TEXT,
    name                   TEXT,
    product_name           TEXT,
    product_category       TEXT,
    account_number_masked  TEXT,
    bsb                    TEXT,
    open_status            TEXT,
    status                 TEXT NOT NULL DEFAULT 'ACTIVE',
    last_synced_at         TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bank_accounts_user ON bank_accounts (user_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bank_accounts_org ON bank_accounts (organization_id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS bank_transactions (
    txn_id               TEXT PRIMARY KEY,
    account_id           TEXT NOT NULL REFERENCES bank_accounts(account_id) ON DELETE CASCADE,
    user_id              TEXT NOT NULL,
    organization_id      TEXT,
    fy                   TEXT NOT NULL,
    txn_date             DATE,
    description          TEXT,
    amount_cents         BIGINT NOT NULL,
    direction            TEXT,
    status               TEXT,
    merchant_name        TEXT,
    provider_category    TEXT,
    raw                  JSONB,
    category             TEXT,
    category_source      TEXT,
    category_confidence  NUMERIC(3,2),
    gst_treatment        TEXT,
    gst_amount_cents     BIGINT,
    review_reason        TEXT,
    review_status        TEXT NOT NULL DEFAULT 'PENDING',
    confirmed_by         TEXT,
    confirmed_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bank_txn_user_fy_date ON bank_transactions (user_id, fy, txn_date);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bank_txn_account_date ON bank_transactions (account_id, txn_date);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bank_txn_user_review ON bank_transactions (user_id, review_reason);
