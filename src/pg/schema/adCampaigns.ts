import { pgTable, text, jsonb, index } from 'drizzle-orm/pg-core';
import { orgs } from './identity';

/**
 * Ad Studio campaigns — one row per campaign the owner builds in the studio,
 * regardless of how many channels (Meta, Google) it launches to. Campaigns are
 * joined against leads (attribution ->> 'utmCampaign') and analytics_events
 * (utm_campaign) for the spend→cash funnel, which per the source-of-truth rule
 * makes this a Postgres-only reporting-adjacent entity (like client_overview /
 * analytics) — no DynamoDB mirror. Timestamps are ISO TEXT, mirroring the DTO
 * exactly (like shop_orders / voice_credit_ledger).
 */
export const adCampaigns = pgTable('ad_campaigns', {
    campaignId: text('campaign_id').primaryKey(),  // client-minted ULID — retry-safe create
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),
    businessProfileId: text('business_profile_id'),
    createdBy: text('created_by').notNull(),
    name: text('name').notNull(),
    objective: text('objective').notNull(),        // leads|calls|sales|awareness|traffic
    status: text('status').notNull(),              // draft|launching|active|paused|ended|error
    channels: jsonb('channels').notNull(),         // ['meta','google']
    destination: jsonb('destination').notNull(),   // { type, url?, siteHost?, path?, phone? }
    creative: jsonb('creative'),                   // { headline, primaryText, imageUrls[], videoUrl, ... }
    audience: jsonb('audience'),                   // { autoTargeting, suburb?, radiusKm?, ageMin?, ageMax? }
    budget: jsonb('budget'),                       // { dailyCents, currency, startDate?, endDate? }
    // The attribution join key — appended to the destination URL as utm_campaign
    // and stamped onto every lead that lands from this campaign.
    utmCampaign: text('utm_campaign').notNull(),
    platform: jsonb('platform'),                   // { meta?: AdPlatformRef, google?: AdPlatformRef }
    lastInsights: jsonb('last_insights'),          // cached per-channel spend/impressions/clicks
    lastInsightsAt: text('last_insights_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
}, (t) => [
    index('ad_campaigns_org_created_idx').on(t.orgId, t.createdAt),
    index('ad_campaigns_org_status_idx').on(t.orgId, t.status),
]);
