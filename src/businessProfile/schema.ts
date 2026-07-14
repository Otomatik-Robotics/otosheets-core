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

/** One day's trading hours; `closed` true means shut that day. */
export const OperatingHoursDaySchema = z.object({
    day: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
    closed: z.boolean().optional(),
    open: z.string().optional(),  // "09:00"
    close: z.string().optional(), // "17:00"
});
export type OperatingHoursDay = z.infer<typeof OperatingHoursDaySchema>;
export const OperatingHoursSchema = z.array(OperatingHoursDaySchema);

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

    // AI-knowledge / marketing (also feed the website builder)
    industry: z.string().nullish(),
    businessSize: z.string().nullish(),
    operatingHours: OperatingHoursSchema.nullish(),
    about: z.string().nullish(),
    serviceAreas: z.array(z.string()).nullish(),
    targetCustomers: z.array(z.string()).nullish(),
    uniqueSellingPoints: z.array(z.string()).nullish(),
    commonQuestions: z.array(CommonQuestionSchema).nullish(),
    chatbotTone: z.enum(['casual', 'friendly', 'professional', 'formal']).nullish(),
    chatbotInstructions: z.string().nullish(),
    googleReviewUrl: z.string().nullish(),

    /**
     * Stamped (ISO) the first time account setup reaches 100% complete —
     * permanent: once set, the setup widget never renders again, even if a
     * contributing field is later cleared. Written by the backend
     * completeness endpoint, never by profile PUT merges.
     */
    setupCompletedAt: z.string().nullish(),

    /**
     * Stamped (ISO) the first time the setup overview modal auto-opens on
     * first login — cross-browser: once set, the modal never auto-opens
     * again anywhere. Written via the setup-seen endpoint only.
     */
    setupModalSeenAt: z.string().nullish(),

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
 *
 * Declared as an explicit interface (not `extends BusinessProfile`): the
 * `z.infer<>` alias does not always resolve its members across a package
 * boundary, which would leave consumers seeing only the three defaulted fields.
 */
export interface ResolvedBusinessProfile {
    businessProfileId: string;
    orgId: string;
    // Identity
    businessName?: string | null;
    legalName?: string | null;
    tradeName?: string | null;
    abn?: string | null;
    acn?: string | null;
    // Tax (defaults applied)
    gstRegistered: boolean;
    taxRate: number;
    taxLabel: string;
    // Contact / address
    phone?: string | null;
    businessEmail?: string | null;
    website?: string | null;
    address?: string | null;
    suburb?: string | null;
    state?: string | null;
    postcode?: string | null;
    // Banking
    bankDetails?: string | null;
    // Branding
    logoKey?: string | null;
    brandColor?: string | null;
    accentColor?: string | null;
    template?: string | null;
    footerText?: string | null;
    paymentInstructions?: string | null;
    // AI-knowledge / marketing (also feed the website builder)
    industry?: string | null;
    businessSize?: string | null;
    operatingHours?: OperatingHoursDay[] | null;
    about?: string | null;
    serviceAreas?: string[] | null;
    targetCustomers?: string[] | null;
    uniqueSellingPoints?: string[] | null;
    commonQuestions?: { q: string; a: string }[] | null;
    chatbotTone?: 'casual' | 'friendly' | 'professional' | 'formal' | null;
    chatbotInstructions?: string | null;
    googleReviewUrl?: string | null;
    setupCompletedAt?: string | null;
    setupModalSeenAt?: string | null;
    createdAt: string;
    updatedAt: string;
}
