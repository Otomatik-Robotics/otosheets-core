import { z } from 'zod';

/**
 * Unified business identity — the store-agnostic contract for the
 * `business_profiles` table. One canonical home for the tax, contact, branding
 * and AI-knowledge data previously fragmented across `orgs` (top-level scalars,
 * `tradeSettings`, `bookingSettings.businessProfile`). See the monorepo plan
 * "Unified business_profile table".
 */

export const CommonQuestionSchema = z.object({
    q: z.string(),
    a: z.string(),
});

export const BusinessProfileStoredSchema = z.object({
    businessProfileId: z.string(),
    orgId: z.string(),

    // Identity
    businessName: z.string().nullish(),
    legalName: z.string().nullish(),
    tradeName: z.string().nullish(),
    abn: z.string().nullish(),
    acn: z.string().nullish(),

    // Tax (single authoritative home)
    gstRegistered: z.boolean().nullish(),
    taxRate: z.number().nullish(),
    taxLabel: z.string().nullish(),

    // Contact / address
    phone: z.string().nullish(),
    businessEmail: z.string().nullish(),
    website: z.string().nullish(),
    address: z.string().nullish(),
    suburb: z.string().nullish(),
    state: z.string().nullish(),
    postcode: z.string().nullish(),

    // Banking
    bankDetails: z.string().nullish(),

    // Branding
    logoKey: z.string().nullish(),
    brandColor: z.string().nullish(),
    accentColor: z.string().nullish(),
    template: z.string().nullish(),
    footerText: z.string().nullish(),
    paymentInstructions: z.string().nullish(),

    // AI-knowledge / marketing
    about: z.string().nullish(),
    serviceAreas: z.array(z.string()).nullish(),
    targetCustomers: z.array(z.string()).nullish(),
    uniqueSellingPoints: z.array(z.string()).nullish(),
    commonQuestions: z.array(CommonQuestionSchema).nullish(),
    chatbotTone: z.enum(['casual', 'friendly', 'professional', 'formal']).nullish(),
    chatbotInstructions: z.string().nullish(),
    googleReviewUrl: z.string().nullish(),

    createdAt: z.string(),
    updatedAt: z.string(),
});
export type BusinessProfile = z.infer<typeof BusinessProfileStoredSchema>;

export const BusinessProfileCreateRequestSchema = BusinessProfileStoredSchema
    .omit({ businessProfileId: true, createdAt: true, updatedAt: true })
    .partial()
    .extend({ orgId: z.string() });
export type BusinessProfileCreateRequest = z.infer<typeof BusinessProfileCreateRequestSchema>;

/**
 * Fully-resolved profile — every consumer reads this shape via
 * `resolveBusinessProfile(orgId)`, with tax defaults applied so no downstream
 * fallback chains are needed.
 */
export interface ResolvedBusinessProfile extends BusinessProfile {
    taxLabel: string;      // defaulted to 'GST'
    taxRate: number;       // defaulted to 10
    gstRegistered: boolean; // defaulted to false
}
