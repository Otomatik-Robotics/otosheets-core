import { z } from 'zod';

/*
 * NOTE: types here are EXPLICIT interfaces, not z.infer — core compiles its
 * d.ts against zod v3 while consumers may resolve `z` to zod v4, and v4 reads
 * v3's ZodEnum tuple generics as a record (keyof-array unions leak into the
 * inferred type). The order module set this precedent; follow it.
 */

export type AdChannel = 'meta' | 'google';
export const AdChannelSchema = z.enum(['meta', 'google']);

export type AdCampaignObjective = 'leads' | 'calls' | 'sales' | 'awareness' | 'traffic';
export const AdCampaignObjectiveSchema = z.enum(['leads', 'calls', 'sales', 'awareness', 'traffic']);

/** draft → launching → active ⇄ paused → ended; launching → error (retryable). */
export type AdCampaignStatus = 'draft' | 'launching' | 'active' | 'paused' | 'ended' | 'error';
export const AdCampaignStatusSchema = z.enum(['draft', 'launching', 'active', 'paused', 'ended', 'error']);

export interface AdDestination {
    type: 'page' | 'phone' | 'whatsapp';
    /** Full landing URL for `page` destinations (the campaign's final URL). */
    url?: string | null;
    siteHost?: string | null;
    path?: string | null;
    phone?: string | null;
}
export const AdDestinationSchema = z.object({
    type: z.enum(['page', 'phone', 'whatsapp']),
    url: z.string().nullish(),
    siteHost: z.string().nullish(),
    path: z.string().nullish(),
    phone: z.string().nullish(),
});

export interface AdCreative {
    headline?: string | null;
    /** Extra headlines (Google PMax accepts up to 15; Meta uses the first). */
    headlines?: string[] | null;
    primaryText?: string | null;
    description?: string | null;
    descriptions?: string[] | null;
    imageUrls?: string[] | null;
    videoUrl?: string | null;
    logoUrl?: string | null;
    callToAction?: string | null;
}
export const AdCreativeSchema = z.object({
    headline: z.string().nullish(),
    headlines: z.array(z.string()).nullish(),
    primaryText: z.string().nullish(),
    description: z.string().nullish(),
    descriptions: z.array(z.string()).nullish(),
    imageUrls: z.array(z.string()).nullish(),
    videoUrl: z.string().nullish(),
    logoUrl: z.string().nullish(),
    callToAction: z.string().nullish(),
});

export interface AdAudience {
    /** Default ON — Advantage+ / PMax auto-targeting beats hand-tuning at SMB budgets. */
    autoTargeting?: boolean;
    suburb?: string | null;
    lat?: number | null;
    lng?: number | null;
    radiusKm?: number | null;
    ageMin?: number | null;
    ageMax?: number | null;
}
export const AdAudienceSchema = z.object({
    autoTargeting: z.boolean().default(true),
    suburb: z.string().nullish(),
    lat: z.number().nullish(),
    lng: z.number().nullish(),
    radiusKm: z.number().nullish(),
    ageMin: z.number().nullish(),
    ageMax: z.number().nullish(),
});

export interface AdBudget {
    dailyCents: number;
    currency?: string;
    startDate?: string | null;
    endDate?: string | null;
}
export const AdBudgetSchema = z.object({
    dailyCents: z.number(),
    currency: z.string().default('AUD'),
    startDate: z.string().nullish(),
    endDate: z.string().nullish(),
});

/** Per-channel platform-side references + state, written as the launch progresses. */
export interface AdPlatformRef {
    status?: string | null;
    campaignId?: string | null;
    adSetId?: string | null;
    adId?: string | null;
    creativeId?: string | null;
    budgetId?: string | null;
    assetGroupId?: string | null;
    error?: string | null;
    launchedAt?: string | null;
}
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

export interface AdCampaignInsights {
    spendCents: number;
    impressions: number;
    clicks: number;
}
export const AdCampaignInsightsSchema = z.object({
    spendCents: z.number().default(0),
    impressions: z.number().default(0),
    clicks: z.number().default(0),
});

export interface AdCampaign {
    campaignId: string;
    orgId: string;
    businessProfileId?: string | null;
    createdBy: string;
    name: string;
    objective: AdCampaignObjective;
    status: AdCampaignStatus;
    channels: AdChannel[];
    destination: AdDestination;
    creative?: AdCreative | null;
    audience?: AdAudience | null;
    budget?: AdBudget | null;
    utmCampaign: string;
    platform?: { meta?: AdPlatformRef | null; google?: AdPlatformRef | null } | null;
    lastInsights?: Record<string, AdCampaignInsights> | null;
    lastInsightsAt?: string | null;
    createdAt: string;
    updatedAt: string;
}
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
