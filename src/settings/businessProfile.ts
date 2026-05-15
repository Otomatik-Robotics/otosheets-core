import { z } from 'zod';

export const CommonQuestionSchema = z.object({
    q: z.string(),
    a: z.string(),
}).passthrough();
export type CommonQuestion = z.infer<typeof CommonQuestionSchema>;

export const BusinessProfileSchema = z.object({
    about: z.string().nullish(),
    serviceAreas: z.array(z.string()).nullish(),
    targetCustomers: z.array(z.string()).nullish(),
    uniqueSellingPoints: z.array(z.string()).nullish(),
    commonQuestions: z.array(CommonQuestionSchema).nullish(),
    chatbotTone: z.string().nullish(),
    chatbotInstructions: z.string().nullish(),
    businessName: z.string().nullish(),
    businessEmail: z.string().nullish(),
    phone: z.string().nullish(),
    website: z.string().nullish(),
    address: z.string().nullish(),
    suburb: z.string().nullish(),
    state: z.string().nullish(),
    postcode: z.string().nullish(),
    abn: z.string().nullish(),
    acn: z.string().nullish(),
    gstRegistered: z.boolean().nullish(),
    bankDetails: z.string().nullish(),
}).passthrough();
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;
