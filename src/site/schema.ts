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
] as const;
export const SiteTemplateIdSchema = z.enum(SITE_TEMPLATE_IDS);
export type SiteTemplateId = z.infer<typeof SiteTemplateIdSchema>;

export const SiteCustomDomainSchema = z.object({
    domain: z.string(),
    hostedZoneId: z.string().optional(),
    nsRecords: z.array(z.string()).optional(),
    certArn: z.string().optional(),
    status: z.enum(['pending_ns', 'ns_verified', 'cert_pending', 'cert_issued', 'attached', 'failed']),
    requestedAt: z.string(),
    updatedAt: z.string().optional(),
});
export type SiteCustomDomain = z.infer<typeof SiteCustomDomainSchema>;

/** Sparse-GSI marker value set while any custom domain is in a non-terminal state. */
export const DOMAINS_PENDING_KEY = 'DOMAIN_PENDING';

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
    publishedAt: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Site = z.infer<typeof SiteSchema>;
