import { z } from 'zod';

/**
 * Auto-reconciliation opt-in (autonomous bank ↔ ledger matching). When
 * enabled, statement ingest stages auto-eligible matches for a single human
 * batch-confirm — no money is written until the user confirms. Absent/null
 * means disabled (opt-in, default OFF).
 */
export const AutoReconcileSettingsSchema = z.object({
    enabled: z.boolean(),
});
export type AutoReconcileSettings = z.infer<typeof AutoReconcileSettingsSchema>;

export const OrgStoredSchema = z.object({
    orgId: z.string(),
    name: z.string(),
    /** Org flavour (e.g. advisor practice vs business) — drift-report addition 2026-07-04 */
    type: z.string().nullish(),
    stripeOnboardingStatus: z.string().nullish(),
    advisorFacts: z.any().nullish(),
    customRoles: z.any().nullish(),
    timezone: z.string().nullish(),
    legalName: z.string().nullish(),
    tradeName: z.string().nullish(),
    slug: z.string().nullish(),
    abn: z.string().nullish(),
    gstRegistered: z.boolean().default(false),
    currency: z.string().default('AUD'),
    taxRate: z.number().nullish(),
    logoUrl: z.string().nullish(),
    brandColor: z.string().nullish(),
    tagline: z.string().nullish(),
    emailSignature: z.string().nullish(),
    bookingSettings: z.any().nullish(),
    tradeSettings: z.any().nullish(),
    autoReconcile: AutoReconcileSettingsSchema.nullish(),
    /** Active business profile (FK → business_profiles). Every consumer resolves through this. */
    businessProfileId: z.string().nullish(),
    stripeAccountId: z.string().nullish(),
    // ─── Per-org subscription & seats ───────────────────────────
    // The org is the billable unit: tier drives the CASL entitlement
    // engine, seatLimit caps members + pending invites (pure pay-per-seat,
    // owner excluded). Stripe customer/subscription belong to the org.
    subscriptionTier: z.enum(['free', 'starter', 'pro']).default('free'),
    subscriptionStatus: z.string().nullish(),
    stripeCustomerId: z.string().nullish(),
    stripeSubscriptionId: z.string().nullish(),
    seatLimit: z.number().default(0),
    encryptedDek: z.string().nullish(),
    dekVersion: z.number().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Organization = z.infer<typeof OrgStoredSchema>;

export const OrgCreateRequestSchema = z.object({
    name: z.string(),
    legalName: z.string().nullish(),
    tradeName: z.string().nullish(),
    slug: z.string().nullish(),
    abn: z.string().nullish(),
    gstRegistered: z.boolean().optional(),
    currency: z.string().optional(),
    taxRate: z.number().nullish(),
});
export type OrgCreateRequest = z.infer<typeof OrgCreateRequestSchema>;
