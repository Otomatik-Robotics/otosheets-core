import { z } from 'zod';

export const PriceBookItemSchema = z.object({
    orgId: z.string(),
    businessProfileId: z.string().nullish(),   // profile scope
    itemId: z.string(),
    name: z.string(),
    description: z.string(),
    unitPrice: z.number(),
    unit: z.string().nullish(),
    /** What the item costs the business — unlocks margin/profitability reporting. */
    costPrice: z.number().nullish(),
    /** Inventory-lite: stock on hand (absent = not tracked for this item). */
    qtyOnHand: z.number().nullish(),
    /** Inventory-lite: low-stock alert threshold. */
    reorderPoint: z.number().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type PriceBookItem = z.infer<typeof PriceBookItemSchema>;
