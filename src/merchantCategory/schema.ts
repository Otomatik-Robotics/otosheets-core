import { z } from 'zod';

/**
 * DTOs for the shared (cross-tenant) merchant → category cache.
 *
 * The cache is a reference-data PRIOR: a resolved merchant answer only exists
 * once ≥ PROMOTION_MIN_ORGS distinct orgs agree on its (plurality) category.
 * See `src/pg/schema/merchantCategories.ts` for the storage model.
 */

/**
 * Distinct orgs that must agree on a merchant's plurality category before it is
 * promoted to a shared answer. Starts conservative (3) so one tenant — or one
 * mistake — can never pollute the shared cache. The gate lives here (core) so
 * both the write path (recordAgreement) and the read path (lookup) agree.
 */
export const PROMOTION_MIN_ORGS = 3;

/** A promoted, shared answer for a merchant — the ONLY thing lookups return. */
export interface MerchantCategoryHit {
    merchantKey: string;
    category: string;
    gstTreatment: string | null;
    /** Distinct orgs behind the winning category (>= PROMOTION_MIN_ORGS). */
    agreeOrgCount: number;
}

/** One agreement event fed into the shared cache. */
export interface MerchantAgreement {
    /** normaliseMerchant(description) output — the cache key. Caller pre-validates it is non-generic. */
    merchantKey: string;
    category: string;
    gstTreatment?: string | null;
    /** The voting tenant — the distinct-org unit behind the promotion gate. */
    orgId: string;
}

export const MerchantAgreementSchema = z.object({
    merchantKey: z.string().min(1),
    category: z.string().min(1),
    gstTreatment: z.string().nullable().optional(),
    orgId: z.string().min(1),
});
