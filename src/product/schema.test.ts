import { describe, it, expect } from 'vitest';
import { ProductVariantSchema, variantPriceCents } from './schema';

describe('variant price inheritance', () => {
    it('accepts a variant with no price', () => {
        // The blank-price case. It used to be unrepresentable, so the editor sent
        // 0 and shadowed the product's real price on every storefront surface.
        const parsed = ProductVariantSchema.parse({
            variantId: 'v1', options: { Option: 'black' },
        });
        expect(parsed.priceCents).toBeUndefined();
    });

    it('inherits the base price when the variant has none', () => {
        expect(variantPriceCents({ priceCents: undefined }, 3900)).toBe(3900);
        expect(variantPriceCents({ priceCents: undefined }, { basePriceCents: 3900 })).toBe(3900);
    });

    it('keeps an explicit variant price, including a free one', () => {
        // 0 stays a PRICE, not a missing value — which is exactly why this is
        // optional rather than "treat 0 as unpriced".
        expect(variantPriceCents({ priceCents: 5900 }, 3900)).toBe(5900);
        expect(variantPriceCents({ priceCents: 0 }, 3900)).toBe(0);
    });

    it('still rejects a negative price', () => {
        expect(() => ProductVariantSchema.parse({
            variantId: 'v1', options: {}, priceCents: -1,
        })).toThrow();
    });
});
