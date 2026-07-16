import { z } from 'zod';

/** Business Launcher steps. Order here is display order on the checklist. */
export const LAUNCH_STEP_IDS = [
    'name_check',
    'abn_verify',
    'profile_saved',
    'media_collected',
    'site_created',
    'branding_applied',
    'price_book_drafted',
    'intake_wired',
    'site_published',
    'stripe_connected',
    'payment_links_created',
    // Phase C
    'domain_purchase',
    'domain_requested',
    'domain_delegated',
    'domain_attached',
    // Phase D
    'social_pack_generated',
    'meta_page_connected',
    'first_posts_scheduled',
] as const;
export const LaunchStepIdSchema = z.enum(LAUNCH_STEP_IDS);
export type LaunchStepId = (typeof LAUNCH_STEP_IDS)[number];

export const LaunchStepStatusSchema = z.enum([
    'pending', 'running', 'waiting_user', 'done', 'failed', 'skipped',
]);
export type LaunchStepStatus = 'pending' | 'running' | 'waiting_user' | 'done' | 'failed' | 'skipped';

export const LaunchStepStateSchema = z.object({
    status: LaunchStepStatusSchema,
    dependsOn: z.array(LaunchStepIdSchema).optional(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    error: z.string().optional(),
    /** Step outputs, e.g. { abn, siteSlug, paymentLinkUrl } — returned as-is on re-runs. */
    artifacts: z.record(z.string(), z.string()).optional(),
});
// Explicit interface (not z.infer): consumers may be on a different zod major,
// and inferred generic types don't survive the declaration-file boundary.
export interface LaunchStepState {
    status: LaunchStepStatus;
    dependsOn?: LaunchStepId[];
    startedAt?: string;
    completedAt?: string;
    error?: string;
    artifacts?: Record<string, string>;
}

export const LAUNCH_ASSET_KINDS = [
    'receipt', 'invoice_doc', 'logo', 'work_photo', 'team_photo', 'document', 'text_note',
] as const;
export const LaunchAssetKindSchema = z.enum(LAUNCH_ASSET_KINDS);
export type LaunchAssetKind = (typeof LAUNCH_ASSET_KINDS)[number];

export const LaunchAssetSchema = z.object({
    /** Deterministic: derived from the S3 key — makes ingest idempotent. */
    assetId: z.string(),
    key: z.string().optional(),
    text: z.string().optional(),
    kind: LaunchAssetKindSchema,
    alt: z.string().optional(),
    chosenFor: z.enum(['hero', 'gallery', 'about', 'logo']).optional(),
    createdAt: z.string(),
});
export interface LaunchAsset {
    assetId: string;
    key?: string;
    text?: string;
    kind: LaunchAssetKind;
    alt?: string;
    chosenFor?: 'hero' | 'gallery' | 'about' | 'logo';
    createdAt: string;
}

export const LaunchProfileServiceSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    suggestedPriceCents: z.number().int().optional(),
    unit: z.string().optional(),
});

export const LaunchProfileSchema = z.object({
    businessName: z.string(),
    businessNameCandidates: z.array(z.string()).default([]),
    abn: z.string().optional(),
    services: z.array(LaunchProfileServiceSchema).default([]),
    serviceAreas: z.array(z.string()).default([]),
    targetCustomers: z.array(z.string()).default([]),
    usps: z.array(z.string()).default([]),
    tone: z.string().optional(),
    tagline: z.string().optional(),
    aboutDraft: z.string().optional(),
    templateSuggestion: z.string().optional(),
    /** Owner-chosen storefront structure. When set it wins over deterministic
     * classification when the launcher builds the site. */
    archetype: z.enum(['website', 'full-shop', 'single-product', 'services', 'consultant']).optional(),
    palette: z.object({ primary: z.string(), accent: z.string() }).optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
});
export interface LaunchProfileService {
    name: string;
    description?: string;
    suggestedPriceCents?: number;
    unit?: string;
}
export interface LaunchProfile {
    businessName: string;
    businessNameCandidates: string[];
    abn?: string;
    services: LaunchProfileService[];
    serviceAreas: string[];
    targetCustomers: string[];
    usps: string[];
    tone?: string;
    tagline?: string;
    aboutDraft?: string;
    templateSuggestion?: string;
    archetype?: 'website' | 'full-shop' | 'single-product' | 'services' | 'consultant';
    palette?: { primary: string; accent: string };
    phone?: string;
    email?: string;
}

/** SK of the pointer item enforcing one active run per org. */
export const LAUNCH_RUN_ACTIVE_POINTER = 'ACTIVE';

export const LaunchRunSchema = z.object({
    orgId: z.string(),
    runId: z.string(),
    status: z.enum(['confirming', 'running', 'completed', 'partially_completed', 'abandoned']),
    transcript: z.string().optional(),
    profile: LaunchProfileSchema,
    steps: z.record(z.string(), LaunchStepStateSchema),
    /** Keyed by assetId so ingest retries are idempotent SETs. */
    assets: z.record(z.string(), LaunchAssetSchema).default({}),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export interface LaunchRun {
    orgId: string;
    runId: string;
    status: 'confirming' | 'running' | 'completed' | 'partially_completed' | 'abandoned';
    transcript?: string;
    profile: LaunchProfile;
    steps: Record<string, LaunchStepState>;
    assets: Record<string, LaunchAsset>;
    createdAt: string;
    updatedAt: string;
}

/** Pointer item shape: { orgId, runId: 'ACTIVE', activeRunId } */
export interface LaunchRunActivePointer {
    orgId: string;
    runId: typeof LAUNCH_RUN_ACTIVE_POINTER;
    activeRunId: string;
    createdAt: string;
}
