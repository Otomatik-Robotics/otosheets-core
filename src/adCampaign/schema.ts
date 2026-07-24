import { z } from 'zod';

export const AdChannelSchema = z.enum(['meta', 'google']);
export type AdChannel = z.infer<typeof AdChannelSchema>;

export const AdCampaignObjectiveSchema = z.enum(['leads', 'calls', 'sales', 'awareness', 'traffic']);
export type AdCampaignObjective = z.infer<typeof AdCampaignObjectiveSchema>;

/** draft → launching → active ⇄ paused → ended; launching → error (retryable). */
export const AdCampaignStatusSchema = z.enum(['draft', 'launching', 'active', 'paused', 'ended', 'error']);
export type AdCampaignStatus = z.infer<typeof AdCampaignStatusSchema>;

export const AdDestinationSchema = z.object({
    type: z.enum(['page', 'phone', 'whatsapp']),
    /** Full landing URL for `page` destinations (the campaign's final URL). */
    url: z.string().nullish(),
    siteHost: z.string().nullish(),
    path: z.string().nullish(),
    phone: z.string().nullish(),
});
export type AdDestination = z.infer<typeof AdDestinationSchema>;

export const AdCreativeSchema = z.object({
    headline: z.string().nullish(),
    /** Extra headlines (Google PMax accepts up to 15; Meta uses the first). */
    headlines: z.array(z.string()).nullish(),
    primaryText: z.string().nullish(),
    description: z.string().nullish(),
    descriptions: z.array(z.string()).nullish(),
    imageUrls: z.array(z.string()).nullish(),
    videoUrl: z.string().nullish(),
    logoUrl: z.string().nullish(),
    callToAction: z.string().nullish(),
});
export type AdCreative = z.infer<typeof AdCreativeSchema>;

export const AdAudienceSchema = z.object({
    /** Default ON — Advantage+ / PMax auto-targeting beats hand-tuning at SMB budgets. */
    autoTargeting: z.boolean().default(true),
    suburb: z.string().nullish(),
    lat: z.number().nullish(),
    lng: z.number().nullish(),
    radiusKm: z.number().nullish(),
    ageMin: z.number().nullish(),
    ageMax: z.number().nullish(),
});
export type AdAudience = z.infer<typeof AdAudienceSchema>;

export const AdBudgetSchema = z.object({
    dailyCents: z.number(),
    currency: z.string().default('AUD'),
    startDate: z.string().nullish(),
    endDate: z.string().nullish(),
});
export type AdBudget = z.infer<typeof AdBudgetSchema>;

/** Per-channel platform-side references + state, written as the launch progresses. */
export const AdPlatformRefSchema = z.object({
    status: z.string().nullish(),
    campaignId: z.string().nullish(),
    adSetId: z.string().nullish(),
    adId: z.string().nullish(),
    creativeId: z.string().nullish(),
    budgetId: z.string().nullish(),
    assetGroupId: z.string().nullish(),
    error: z.string().nullish(),
    launchedAt: z.string().nullish(),
});
export type AdPlatformRef = z.infer<typeof AdPlatformRefSchema>;

export const AdCampaignInsightsSchema = z.object({
    spendCents: z.number().default(0),
    impressions: z.number().default(0),
    clicks: z.number().default(0),
});
export type AdCampaignInsights = z.infer<typeof AdCampaignInsightsSchema>;

export const AdCampaignSchema = z.object({
    campaignId: z.string(),
    orgId: z.string(),
    businessProfileId: z.string().nullish(),
    createdBy: z.string(),
    name: z.string(),
    objective: AdCampaignObjectiveSchema,
    status: AdCampaignStatusSchema,
    channels: z.array(AdChannelSchema),
    destination: AdDestinationSchema,
    creative: AdCreativeSchema.nullish(),
    audience: AdAudienceSchema.nullish(),
    budget: AdBudgetSchema.nullish(),
    utmCampaign: z.string(),
    platform: z.object({
        meta: AdPlatformRefSchema.nullish(),
        google: AdPlatformRefSchema.nullish(),
    }).nullish(),
    lastInsights: z.record(z.string(), AdCampaignInsightsSchema).nullish(),
    lastInsightsAt: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type AdCampaign = z.infer<typeof AdCampaignSchema>;

/** Deterministic attribution slug — stable across retries, parseable back to the campaign. */
export function utmCampaignFor(campaignId: string): string {
    return `oto_${campaignId.toLowerCase()}`;
}

/** Per-campaign lead outcomes joined from the leads table. */
export interface AdCampaignLeadStats {
    utmCampaign: string;
    leads: number;
    qualified: number;
    won: number;
    wonValue: number;
}

/** Landing-traffic counts joined from analytics_events. */
export interface AdCampaignVisitStats {
    utmCampaign: string;
    visits: number;
    sessions: number;
}

/** "Where leads come from" — per-channel split including organic/direct. */
export interface LeadSourceSplitRow {
    channel: string;
    leads: number;
    won: number;
    wonValue: number;
}
