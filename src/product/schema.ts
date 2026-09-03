import { z } from 'zod';

/**
 * Product — a sellable item on a storefront shop (table `expense-app-products-{env}`,
 * PK `orgId`, SK `productId` ULID). DynamoDB-only (keyed / owner-scoped hot-path read
 * on the public renderer); shop revenue reaches the Postgres ledger via the paid
 * invoice the order webhook dual-writes, not this table.
 *
 * Prices are in **cents** (storefront + Stripe convention). Services stay on the
 * dollars-based price book; simple products may carry `priceBookItemId` so their base
 * price stays in sync with invoicing.
 *
 * Explicit interfaces (not z.infer) — consumers may be on a different zod major and
 * inferred generics don't survive the .d.ts boundary.
 */

export const PRODUCT_SHIPPING_CLASSES = ['physical', 'pickup', 'digital'] as const;
export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export const PRODUCT_TAX_BEHAVIOURS = ['inclusive', 'exclusive'] as const;

/** Max variants per product — bounds the item well under the 400 KB row limit. */
export const PRODUCT_VARIANTS_MAX = 50;
/** Max images per product. */
export const PRODUCT_IMAGES_MAX = 8;

export const ProductImageSchema = z.object({
    /** Deterministic site-asset id (dedupe key), when the image came from the asset library. */
    assetId: z.string().optional(),
    url: z.string(),
    alt: z.string().max(200).optional(),
});
export interface ProductImage {
    assetId?: string;
    url: string;
    alt?: string;
}

export const ProductVariantSchema = z.object({
    variantId: z.string(),
    /** Option name → value, e.g. { Size: 'Medium' } or { Colour: 'Sage' }. */
    options: z.record(z.string(), z.string()),
    sku: z.string().max(60).optional(),
    /**
     * ABSENT MEANS "INHERIT THE PRODUCT'S `basePriceCents`" — it is not zero.
     *
     * This was required, and a blank price field in the variant editor therefore
     * had nowhere to go but `0`. Because `priceRange()` prefers variants whenever
     * any exist, one priced-0 variant silently SHADOWED a perfectly good base
     * price across every surface — listing, PDP and cart all read $0 on a product
     * whose editor still showed $39. The owner had no way to see it: the title
     * comes from a different field, so nothing looked broken.
     *
     * Optional rather than "treat 0 as unpriced", because 0 has to stay
     * expressible: a genuinely free variant is a real thing, and inferring intent
     * from the value would make it impossible to say. Absent is the absence of a
     * price; 0 is a price of nothing.
     *
     * Readers MUST resolve it via `variantPriceCents()` below. The type is
     * deliberately widened to `number | undefined` so the compiler names every
     * site that has to make that decision.
     */
    priceCents: z.number().int().nonnegative().optional(),
    /**
     * null / undefined = untracked (always available).
     *
     * When `priceBookItemId` is set this is a CACHE of the catalogue's on-hand
     * figure, not an independent number — `applyStockDelta` pushes the true
     * level here after every movement. It is still decremented conditionally at
     * checkout, because that conditional IS the no-oversell guard; the push
     * then corrects it to truth.
     */
    stock: z.number().int().nonnegative().nullish(),
    /**
     * The catalogue item this variant draws stock from.
     *
     * Linked at the VARIANT, not the product: a variant is the SKU, so S/M/L
     * are three stock items and one product-level link cannot serve them. The
     * older product-level `priceBookItemId` still works for single-variant
     * products and is used as the fallback.
     */
    priceBookItemId: z.string().nullish(),
    /** Index into the product's images[] for this variant's photo. */
    imageIndex: z.number().int().nonnegative().optional(),
});
export interface ProductVariant {
    variantId: string;
    options: Record<string, string>;
    sku?: string;
    /** Absent = inherit `basePriceCents`. Resolve via `variantPriceCents()`. */
    priceCents?: number;
    stock?: number | null;
    priceBookItemId?: string | null;
    imageIndex?: number;
}

export const ProductSchema = z.object({
    orgId: z.string(),
    productId: z.string(),
    businessProfileId: z.string().nullish(),
    /** URL slug, unique per org — used at /shop/{slug}. */
    slug: z.string(),
    title: z.string().min(1).max(140),
    description: z.string().max(4000).default(''),
    images: z.array(ProductImageSchema).max(PRODUCT_IMAGES_MAX).default([]),
    status: z.enum(PRODUCT_STATUSES),
    /** When false the storefront shows the product but hides the Buy button. */
    sellable: z.boolean().default(true),
    shippingClass: z.enum(PRODUCT_SHIPPING_CLASSES),
    /** Base/display price in cents; variant prices override per-variant. */
    basePriceCents: z.number().int().nonnegative(),
    currency: z.string().default('AUD'),
    taxBehaviour: z.enum(PRODUCT_TAX_BEHAVIOURS).default('inclusive'),
    /** Optional link to a price-book item (keeps a simple product in invoicing sync). */
    priceBookItemId: z.string().nullish(),
    variants: z.array(ProductVariantSchema).max(PRODUCT_VARIANTS_MAX).default([]),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export interface Product {
    orgId: string;
    productId: string;
    businessProfileId?: string | null;
    slug: string;
    title: string;
    description: string;
    images: ProductImage[];
    status: 'draft' | 'active' | 'archived';
    sellable: boolean;
    shippingClass: 'physical' | 'pickup' | 'digital';
    basePriceCents: number;
    currency: string;
    taxBehaviour: 'inclusive' | 'exclusive';
    priceBookItemId?: string | null;
    variants: ProductVariant[];
    createdAt: string;
    updatedAt: string;
}

/**
 * The price a variant actually sells at.
 *
 * ONE implementation, because the variant-price question had four copies in the
 * storefront renderer alone (`liquid/types.ts`, `shopPages.tsx`, `fullShop.tsx`,
 * `singleProduct*.tsx`) plus a fifth in the cart client. A rule that lives in
 * four places is a rule that will be applied in three.
 *
 * `priceCents` absent means inherit; see the field's note. Callers that hold only
 * a variant and a base figure (the render view-models flatten the product away)
 * can pass the number directly.
 */
export function variantPriceCents(
    variant: Pick<ProductVariant, 'priceCents'>,
    base: number | Pick<Product, 'basePriceCents'>,
): number {
    const fallback = typeof base === 'number' ? base : base.basePriceCents;
    return variant.priceCents ?? fallback;
}
