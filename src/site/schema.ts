import { z } from 'zod';

/** Predesigned storefront templates. Sites are ALWAYS rendered from one of these —
 *  the config fills typed content slots; templates own all layout/HTML/CSS. */
export const SITE_TEMPLATE_IDS = [
    'industrial-bold',
    'clean-corporate',
    'warm-local',
    'minimal-studio',
    'fresh-bright',
    'night-shift',
    'coastal-luxe',
    'heritage-craft',
    'electric-pop',
    'terra-organic',
    'noir-gold',
    'nordic-frost',
] as const;
export const SiteTemplateIdSchema = z.enum(SITE_TEMPLATE_IDS);
export type SiteTemplateId = (typeof SITE_TEMPLATE_IDS)[number];

export const SiteCustomDomainSchema = z.object({
    domain: z.string(),
    hostedZoneId: z.string().optional(),
    nsRecords: z.array(z.string()).optional(),
    certArn: z.string().optional(),
    status: z.enum(['pending_ns', 'ns_verified', 'cert_pending', 'cert_issued', 'attached', 'failed']),
    requestedAt: z.string(),
    updatedAt: z.string().optional(),
});
// Explicit interfaces (not z.infer): consumers may be on a different zod major,
// and inferred generic types don't survive the declaration-file boundary.
export interface SiteCustomDomain {
    domain: string;
    hostedZoneId?: string;
    nsRecords?: string[];
    certArn?: string;
    status: 'pending_ns' | 'ns_verified' | 'cert_pending' | 'cert_issued' | 'attached' | 'failed';
    requestedAt: string;
    updatedAt?: string;
}

/** Sparse-GSI marker value set while any custom domain is in a non-terminal state. */
export const DOMAINS_PENDING_KEY = 'DOMAIN_PENDING';

// ─── Site posts ("Updates" blog) ─────────────────────────────────────────────

/** Post summary kept in the site row's `posts` registry — the public /updates
 *  index and the owner's post list render from this map without touching the
 *  post rows themselves (the site row is already loaded on every render). */
export const SitePostSummarySchema = z.object({
    postId: z.string(),
    /** URL slug, unique per site — immutable after create (it IS the row key). */
    slug: z.string(),
    title: z.string(),
    status: z.enum(['draft', 'published']),
    heroImageUrl: z.string().optional(),
    publishedAt: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export interface SitePostSummary {
    postId: string;
    slug: string;
    title: string;
    status: 'draft' | 'published';
    heroImageUrl?: string;
    publishedAt?: string;
    createdAt: string;
    updatedAt: string;
}

/** Full post row, stored in the sites table under postHostKey(siteSlug, slug).
 *  The '#' in the key makes it collision-free with real hostnames, and
 *  attribute_not_exists(host) on create gives per-site slug uniqueness. */
export const SitePostSchema = SitePostSummarySchema.extend({
    siteSlug: z.string(),
    /** Structured content blocks — validated against the storefront block
     *  schema at the handler boundary, exactly like Site.config. */
    blocks: z.array(z.unknown()),
});
export interface SitePost extends SitePostSummary {
    siteSlug: string;
    blocks: unknown[];
}

/** Sites-table PK for a post row. */
export function postHostKey(siteSlug: string, postSlug: string): string {
    return `post#${siteSlug}#${postSlug}`;
}

/** Registry cap — a bounded map on the site item, like `assets`. */
export const SITE_POSTS_MAX = 200;

export const SiteSchema = z.object({
    /** PK. Canonical rows: the subdomain label (e.g. "joesmowing"). Alias rows: the full custom domain. */
    host: z.string(),
    type: z.enum(['site', 'alias']).default('site'),
    /** Alias rows only — the canonical host this domain points at. */
    aliasOf: z.string().optional(),
    orgId: z.string(),
    /** Always the canonical subdomain label, on alias rows too. */
    slug: z.string(),
    templateId: SiteTemplateIdSchema,
    status: z.enum(['draft', 'published', 'suspended']),
    /** SiteConfig — validated against SiteConfigSchema (@otosheets/shared) at the handler boundary. */
    config: z.record(z.string(), z.unknown()),
    /** Bumped on every config save; used as the CloudFront cache-bust query param. */
    configVersion: z.number().int(),
    customDomains: z.array(SiteCustomDomainSchema).default([]),
    /** Sparse GSI attribute — present (= DOMAINS_PENDING_KEY) only while a domain is in flight. */
    domainsPendingKey: z.string().optional(),
    /** Random token gating draft previews (?preview=1&t=...). Only handed out by the authed sites API. */
    previewToken: z.string().optional(),
    /** Site asset library, keyed by deterministic assetId (idempotent ingest).
     *  logo → branding; work/team photos → portfolio; documents → business material. */
    assets: z.record(z.string(), z.object({
        assetId: z.string(),
        key: z.string(),
        kind: z.enum(['logo', 'work_photo', 'team_photo', 'document']),
        alt: z.string().optional(),
        createdAt: z.string(),
    })).optional(),
    /** Post registry, keyed by postId — summaries only; bodies live in post rows. */
    posts: z.record(z.string(), SitePostSummarySchema).optional(),
    publishedAt: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export interface SiteAsset {
    assetId: string;
    key: string;
    kind: 'logo' | 'work_photo' | 'team_photo' | 'document';
    alt?: string;
    createdAt: string;
}

export interface Site {
    host: string;
    type: 'site' | 'alias';
    aliasOf?: string;
    orgId: string;
    slug: string;
    templateId: SiteTemplateId;
    status: 'draft' | 'published' | 'suspended';
    config: Record<string, unknown>;
    configVersion: number;
    customDomains: SiteCustomDomain[];
    domainsPendingKey?: string;
    previewToken?: string;
    assets?: Record<string, SiteAsset>;
    posts?: Record<string, SitePostSummary>;
    publishedAt?: string;
    createdAt: string;
    updatedAt: string;
}
