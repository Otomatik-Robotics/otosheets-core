CREATE TABLE IF NOT EXISTS users (
    user_id             TEXT PRIMARY KEY,
    email               TEXT NOT NULL,
    first_name          TEXT,
    last_name           TEXT,
    full_name           TEXT NOT NULL,
    business_name       TEXT,
    trade_name          TEXT,
    slug                TEXT,
    timezone            TEXT NOT NULL DEFAULT 'Australia/Sydney',
    tagline             TEXT,
    brand_color         TEXT,
    logo_url            TEXT,
    status              TEXT NOT NULL DEFAULT 'ACTIVE',
    profile_picture_key TEXT,
    phone               TEXT,
    stripe_account_id       TEXT,
    stripe_customer_id      TEXT,
    stripe_subscription_id  TEXT,
    subscription_tier       TEXT,
    subscription_status     TEXT,
    category_rules       JSONB,
    booking_settings     JSONB,
    calendar_connections JSONB,
    meta_pages           JSONB,
    trade_settings       JSONB,
    email_connections    JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (email);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS users_slug_uq ON users (slug) WHERE slug IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS orgs (
    org_id              TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    legal_name          TEXT,
    trade_name          TEXT,
    slug                TEXT,
    abn                 TEXT,
    gst_registered      BOOLEAN NOT NULL DEFAULT false,
    currency            TEXT NOT NULL DEFAULT 'AUD',
    tax_rate            NUMERIC(6,3),
    logo_url            TEXT,
    brand_color         TEXT,
    tagline             TEXT,
    email_signature     TEXT,
    booking_settings    JSONB,
    trade_settings      JSONB,
    stripe_account_id   TEXT,
    subscription_tier   TEXT NOT NULL DEFAULT 'free',
    subscription_status TEXT,
    stripe_customer_id      TEXT,
    stripe_subscription_id  TEXT,
    seat_limit          INTEGER NOT NULL DEFAULT 0,
    encrypted_dek       TEXT,
    dek_version         INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS orgs_slug_uq ON orgs (slug) WHERE slug IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS memberships (
    org_id          TEXT NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL,
    membership_id   TEXT,
    role            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'PENDING',
    first_name      TEXT,
    last_name       TEXT,
    invite_name     TEXT,
    invite_token    TEXT,
    invite_expires_at TIMESTAMPTZ,
    invite_email    TEXT,
    invite_phone    TEXT,
    invited_by      TEXT,
    invited_at      TIMESTAMPTZ,
    joined_at       TIMESTAMPTZ,
    availability        JSONB,
    calendar_connection JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS memberships_invite_token_uq ON memberships (invite_token) WHERE invite_token IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships (user_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS teams (
    team_id     TEXT PRIMARY KEY,
    org_id      TEXT NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS teams_org_idx ON teams (org_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS team_members (
    team_id     TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    member_id   TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (team_id, member_id)
);
