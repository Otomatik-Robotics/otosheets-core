-- Ad Studio (0033): campaigns + lead attribution + per-user ad-platform connections.
-- Campaigns are Postgres-only (reporting-layer entity — joined against leads and
-- analytics_events for the spend→cash funnel; no DynamoDB mirror).
CREATE TABLE IF NOT EXISTS ad_campaigns (
    campaign_id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    business_profile_id text,
    created_by text NOT NULL,
    name text NOT NULL,
    objective text NOT NULL,
    status text NOT NULL,
    channels jsonb NOT NULL,
    destination jsonb NOT NULL,
    creative jsonb,
    audience jsonb,
    budget jsonb,
    utm_campaign text NOT NULL,
    platform jsonb,
    last_insights jsonb,
    last_insights_at text,
    created_at text NOT NULL,
    updated_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ad_campaigns_org_created_idx ON ad_campaigns (org_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ad_campaigns_org_status_idx ON ad_campaigns (org_id, status);
--> statement-breakpoint
-- First-party ad attribution stamped onto leads at ingest (UTMs + gclid/fbclid +
-- referrer + landing page). Nullable/sparse-safe: absent for all pre-existing and
-- non-attributed leads, exactly as DynamoDB stores it.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS attribution jsonb;
--> statement-breakpoint
-- Funnel join: count leads per campaign via attribution ->> 'utmCampaign'.
CREATE INDEX IF NOT EXISTS leads_org_utm_campaign_idx ON leads (org_id, (attribution ->> 'utmCampaign'));
--> statement-breakpoint
-- Ad Studio platform connections (Meta ads / Google Ads OAuth) on the user row,
-- following the metaPages / calendarConnections / emailConnections precedent.
ALTER TABLE users ADD COLUMN IF NOT EXISTS ads_connections jsonb;
