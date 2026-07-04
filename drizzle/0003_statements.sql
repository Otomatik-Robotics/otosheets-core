-- Statements domain — born in Postgres (bank statement extraction + categorisation).
-- Money is integer cents (BIGINT): the verification engine requires exact arithmetic.
CREATE TABLE IF NOT EXISTS statements (
    statement_id        TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    organization_id     TEXT,
    fy                  TEXT NOT NULL,
    file_name           TEXT,
    file_type           TEXT,
    s3_key              TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'UPLOADED',
    content_hash        TEXT,
    extraction_version  INTEGER NOT NULL DEFAULT 0,
    textract_job_id     TEXT,
    bank_name           TEXT,
    account_last4       TEXT,
    period_start        DATE,
    period_end          DATE,
    verification        JSONB,
    txn_count           INTEGER,
    needs_review_count  INTEGER,
    confirmed_count     INTEGER,
    error_message       TEXT,
    duplicate_of_statement_id TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at        TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS statements_user_fy ON statements (user_id, fy);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS statements_org ON statements (organization_id, fy) WHERE organization_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS statements_dedupe ON statements (user_id, content_hash) WHERE content_hash IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS statement_transactions (
    txn_id              TEXT PRIMARY KEY,
    statement_id        TEXT NOT NULL REFERENCES statements(statement_id) ON DELETE CASCADE,
    user_id             TEXT NOT NULL,
    fy                  TEXT NOT NULL,
    seq                 INTEGER NOT NULL,
    page                INTEGER,
    row_index           INTEGER,
    bbox                JSONB,
    raw_text            TEXT,
    txn_date            DATE,
    description         TEXT,
    amount_cents        BIGINT NOT NULL,
    direction           TEXT,
    balance_cents       BIGINT,
    chain_ok            BOOLEAN,
    verification_flags  JSONB,
    category            TEXT,
    category_source     TEXT,
    category_confidence NUMERIC(3,2),
    gst_treatment       TEXT,
    gst_amount_cents    BIGINT,
    review_reason       TEXT,
    review_status       TEXT NOT NULL DEFAULT 'PENDING',
    confirmed_by        TEXT,
    confirmed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT stmt_txn_statement_seq UNIQUE (statement_id, seq)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stmt_txn_user_fy_date ON statement_transactions (user_id, fy, txn_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stmt_txn_review ON statement_transactions (user_id, review_reason) WHERE review_reason IS NOT NULL;
