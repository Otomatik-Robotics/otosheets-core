-- New profile-bound snapshots; do not infer ownership for legacy BAS rows.
CREATE TABLE IF NOT EXISTS business_profile_bas_periods (
    org_id TEXT NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    business_profile_id TEXT NOT NULL,
    period TEXT NOT NULL,
    fy TEXT NOT NULL,
    quarter SMALLINT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    due_date TEXT NOT NULL,
    lodged_at TIMESTAMPTZ,
    lodged_by TEXT,
    figures JSONB,
    confidence SMALLINT,
    reasons JSONB,
    reminder_before_at TIMESTAMPTZ,
    reminder_due_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, business_profile_id, period)
);
