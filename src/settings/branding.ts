import { z } from 'zod';

export const BrandingSchema = z.object({
    primaryColor: z.string().default('#4f46e5'),
    accentColor: z.string().default('#7c3aed'),
    template: z.string().nullish(),
    logoKey: z.string().nullish(),
    logoUrl: z.string().nullish(),
    footerText: z.string().nullish(),
    paymentInstructions: z.string().nullish(),
}).passthrough();
export type Branding = z.infer<typeof BrandingSchema>;
