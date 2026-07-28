import { z } from 'zod';

/**
 * Pricebook DTOs (0037).
 *
 * A CATALOGUE ITEM (`PriceBookItem`, unchanged by this module) is the physical
 * thing: one row per thing, owning identity, unit, cost, stock, supplier. A
 * PRICEBOOK is a named set of PRICES over those items, and an org has many.
 *
 * `type` is mechanical:
 *   - standard: membership IMPLICIT (every item is in it), a missing entry falls
 *     through to the default book, order meaningless. This is the quoting book.
 *   - catalog: membership EXPLICIT (being in it is the point), a missing entry
 *     means NOT IN this catalogue, and `position` matters — it is a display list.
 *
 * Consequence worth stating: an item's price is only meaningful RELATIVE TO A
 * BOOK, because the same item can sit in two catalogues at two prices. Stock is
 * not — `qtyOnHand` lives on the item and no pricing write ever touches it.
 *
 * Types are declared as explicit interfaces rather than `z.infer` — inferred
 * generics do not survive the `.d.ts` boundary across zod majors (1420c95).
 */

export type PriceBookType = 'standard' | 'catalog';

export interface PriceBook {
    priceBookId: string;
    orgId: string;
    businessProfileId: string | null;
    name: string;
    type: PriceBookType;
    /** The org's fall-through book. Exactly one per org; immutable; undeletable. */
    isDefault: boolean;
    description: string | null;
    createdAt: string;
    updatedAt: string;
}

/** A book as it appears in a list — plus how many priced rows it holds. */
export interface PriceBookListItem extends PriceBook {
    itemCount: number;
}

export interface PriceBookEntry {
    orgId: string;
    priceBookId: string;
    itemId: string;
    /** The price in THIS book. null = inherit (fall through). */
    unitPrice: number | null;
    position: number;
    createdAt: string;
    updatedAt: string;
}

/** An entry joined to its catalogue item — one row of a book's item page. */
export interface PriceBookEntryRow {
    priceBookId: string;
    itemId: string;
    position: number;
    /** The resolved price in this book (entry → default book → item). May be null. */
    price: number | null;
    /** True when `price` did NOT come from this entry. */
    inherited: boolean;
    name: string;
    description: string | null;
    unit: string | null;
    costPrice: number | null;
    qtyOnHand: number | null;
    reorderPoint: number | null;
    supplierId: string | null;
}

export interface ResolvedPrice {
    price: number | null;
    source: 'entry' | 'default-book' | 'item' | 'none';
}

export const PriceBookTypeSchema = z.enum(['standard', 'catalog']);

export const PriceBookSchema = z.object({
    priceBookId: z.string(),
    orgId: z.string(),
    businessProfileId: z.string().nullable(),
    name: z.string(),
    type: PriceBookTypeSchema,
    isDefault: z.boolean(),
    description: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const PriceBookEntrySchema = z.object({
    orgId: z.string(),
    priceBookId: z.string(),
    itemId: z.string(),
    unitPrice: z.number().nullable(),
    position: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
