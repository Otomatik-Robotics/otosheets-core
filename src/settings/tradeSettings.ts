import { z } from 'zod';
import { BrandingSchema } from './branding';
import { GeofenceSettingsSchema } from './geofenceSettings';

export const ComplianceCertSchema = z.object({
    name: z.string(),
    number: z.string(),
    expiry: z.string(),
}).passthrough();
export type ComplianceCert = z.infer<typeof ComplianceCertSchema>;

export const TradeSettingsSchema = z.object({
    tradeName: z.string().nullish(),
    licenceNumber: z.string().nullish(),
    licenceExpiry: z.string().nullish(),
    warrantyPeriod: z.string().nullish(),
    certPrefix: z.string().nullish(),
    insurancePolicyNumber: z.string().nullish(),
    insuranceExpiry: z.string().nullish(),
    complianceCerts: z.array(ComplianceCertSchema).nullish(),
    branding: BrandingSchema.nullish(),
    geofenceSettings: GeofenceSettingsSchema.nullish(),
    address: z.string().nullish(),
    email: z.string().nullish(),
    bankName: z.string().nullish(),
    bsb: z.string().nullish(),
    accountNumber: z.string().nullish(),
}).passthrough();
export type TradeSettings = z.infer<typeof TradeSettingsSchema>;
