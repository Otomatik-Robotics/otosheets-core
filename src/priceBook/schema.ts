import { z } from 'zod';

export const PriceBookItemSchema = z.object({
    orgId: z.string(),
    itemId: z.string(),
    name: z.string(),
    description: z.string(),
    unitPrice: z.number(),
    unit: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type PriceBookItem = z.infer<typeof PriceBookItemSchema>;
