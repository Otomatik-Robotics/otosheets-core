import { z } from 'zod';
import { AvailabilitySettingsSchema } from '../settings/availabilitySettings';
import { BusinessProfileSchema } from '../settings/businessProfile';
import { TradeSettingsSchema } from '../settings/tradeSettings';

const OrgBookingSettingsSchema = AvailabilitySettingsSchema.extend({
    businessProfile: BusinessProfileSchema.nullish(),
}).passthrough();

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
    bookingSettings: OrgBookingSettingsSchema.nullish(),
    tradeSettings: TradeSettingsSchema.nullish(),
    stripeAccountId: z.string().nullish(),
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
