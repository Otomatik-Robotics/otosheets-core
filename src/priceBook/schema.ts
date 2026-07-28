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
    /**
     * Who the business buys this item from.
     *
     * The FK only — no name snapshot. Suppliers live in their own table and the
     * name is joined at render, so renaming a supplier does not leave stale
     * copies scattered through the price book.
     *
     * Set when adding an item by hand, and stamped across every row of a
     * multimodal import: importing a price list is importing SOMEONE'S price
     * list, so the whole batch belongs to one supplier.
     */
    supplierId: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type PriceBookItem = z.infer<typeof PriceBookItemSchema>;
