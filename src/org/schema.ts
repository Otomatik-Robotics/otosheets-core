import { z } from 'zod';

export const OrgStoredSchema = z.object({
    orgId: z.string(),
    name: z.string(),
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
