import { z } from 'zod';
import { CalendarConnectionSchema } from '../settings/calendarConnection';
import { AvailabilitySettingsSchema } from '../settings/availabilitySettings';
import { TradeSettingsSchema } from '../settings/tradeSettings';
import { FollowUpSequenceSchema } from '../settings/followUpSequence';

const UserTradeSettingsSchema = TradeSettingsSchema.extend({
    followUpSequence: FollowUpSequenceSchema.nullish(),
}).passthrough();

export const UserStoredSchema = z.object({
    userId: z.string(),
    email: z.string().email(),
    firstName: z.string().nullish(),
    lastName: z.string().nullish(),
    fullName: z.string(),
    businessName: z.string().nullish(),
    tradeName: z.string().nullish(),
    slug: z.string().nullish(),
    timezone: z.string().default('Australia/Sydney'),
    tagline: z.string().nullish(),
    brandColor: z.string().nullish(),
    logoUrl: z.string().nullish(),
    status: z.string().default('ACTIVE'),
    profilePictureKey: z.string().nullish(),
    phone: z.string().nullish(),
    stripeAccountId: z.string().nullish(),
    stripeCustomerId: z.string().nullish(),
    subscriptionTier: z.string().nullish(),
    subscriptionStatus: z.string().nullish(),
    categoryRules: z.record(z.string(), z.unknown()).nullish(),
    bookingSettings: AvailabilitySettingsSchema.nullish(),
    calendarConnections: z.record(z.string(), CalendarConnectionSchema).nullish(),
    metaPages: z.any().nullish(),
    tradeSettings: UserTradeSettingsSchema.nullish(),
    emailConnections: z.any().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type User = z.infer<typeof UserStoredSchema>;

export const UserCreateRequestSchema = z.object({
    email: z.string().email(),
    fullName: z.string(),
    firstName: z.string().nullish(),
    lastName: z.string().nullish(),
    businessName: z.string().nullish(),
    tradeName: z.string().nullish(),
    slug: z.string().nullish(),
    timezone: z.string().optional(),
    phone: z.string().nullish(),
});
export type UserCreateRequest = z.infer<typeof UserCreateRequestSchema>;
