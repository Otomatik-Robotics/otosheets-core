import { z } from 'zod';

/*
 * NOTE: types here are EXPLICIT interfaces, not z.infer — core compiles its
 * d.ts against zod v3 while consumers may resolve `z` to zod v4 (the form and
 * order modules set this precedent; follow it).
 */

/** What kind of thing the asset is. Drives the default effective-life hint in the UI, not the maths here. */
export type AssetCategory = 'VEHICLE' | 'COMPUTER' | 'OFFICE' | 'TOOLS' | 'PLANT' | 'FURNITURE' | 'OTHER';
export const AssetCategorySchema = z.enum(['VEHICLE', 'COMPUTER', 'OFFICE', 'TOOLS', 'PLANT', 'FURNITURE', 'OTHER']);

export type AssetStatus = 'ACTIVE' | 'DISPOSED';
export const AssetStatusSchema = z.enum(['ACTIVE', 'DISPOSED']);

/** How the asset left the business. */
export type AssetDisposalKind = 'SOLD' | 'SCRAPPED' | 'TRADED_IN' | 'PRIVATE_USE' | 'LOST';
export const AssetDisposalKindSchema = z.enum(['SOLD', 'SCRAPPED', 'TRADED_IN', 'PRIVATE_USE', 'LOST']);

export interface AssetDisposal {
    /** YYYY-MM-DD */
    date: string;
    /** Sale proceeds including GST (0 for scrapped/lost). Dollars. */
    proceedsIncGst: number;
    /** GST included in the proceeds. Dollars. */
    gstOnSale: number;
    kind: AssetDisposalKind;
}
export const AssetDisposalSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    proceedsIncGst: z.number().min(0),
    gstOnSale: z.number().min(0),
    kind: AssetDisposalKindSchema,
});

/** A later capital cost added to the asset (an upgrade, an improvement). */
export interface AssetCostAddition {
    /** YYYY-MM-DD */
    date: string;
    /** Dollars, including GST. */
    amountIncGst: number;
    /** Dollars. */
    gstOnAmount: number;
    description?: string | null;
    receiptId?: string | null;
}
export const AssetCostAdditionSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amountIncGst: z.number().min(0),
    gstOnAmount: z.number().min(0),
    description: z.string().max(200).nullish(),
    receiptId: z.string().nullish(),
});

/** A dated re-statement of the business-use percentage (logbook review, change of use). */
export interface AssetBusinessUseReview {
    /** YYYY-MM-DD — the change applies from this date. */
    date: string;
    businessUsePercent: number;
    note?: string | null;
}
export const AssetBusinessUseReviewSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    businessUsePercent: z.number().min(0).max(100),
    note: z.string().max(400).nullish(),
});

export interface AssetDTO {
    assetId: string;
    orgId: string;
    businessProfileId?: string | null;
    ownerId: string;
    createdBy?: string | null;
    name: string;
    category: AssetCategory;
    /** A car for the ATO car-limit and logbook rules (not every VEHICLE is — a ute over 1t is not). */
    isCar: boolean;
    /** Dollars. */
    priceIncGst: number;
    /** Dollars. */
    gstOnPrice: number;
    /** 0–100. */
    businessUsePercent: number;
    /** YYYY-MM-DD */
    purchaseDate: string;
    /** YYYY-MM-DD; null until the owner records it — depreciation cannot start without it. */
    firstUsedDate: string | null;
    /** The receipt this asset was promoted from, if any. Unique per org. */
    receiptId: string | null;
    ledgerAccountCode?: string | null;
    notes?: string | null;
    status: AssetStatus;
    disposal: AssetDisposal | null;
    costAdditions: AssetCostAddition[];
    businessUseReviews: AssetBusinessUseReview[];
    /** ISO timestamps. */
    createdAt: string;
    updatedAt: string;
}
export const AssetSchema = z.object({
    assetId: z.string(),
    orgId: z.string(),
    businessProfileId: z.string().nullish(),
    ownerId: z.string(),
    createdBy: z.string().nullish(),
    name: z.string().min(1).max(160),
    category: AssetCategorySchema,
    isCar: z.boolean(),
    priceIncGst: z.number().min(0),
    gstOnPrice: z.number().min(0),
    businessUsePercent: z.number().min(0).max(100),
    purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    firstUsedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    receiptId: z.string().nullable(),
    ledgerAccountCode: z.string().max(40).nullish(),
    notes: z.string().max(2000).nullish(),
    status: AssetStatusSchema,
    disposal: AssetDisposalSchema.nullable(),
    costAdditions: z.array(AssetCostAdditionSchema),
    businessUseReviews: z.array(AssetBusinessUseReviewSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
});

/** The API body for creating an asset (POST /api/assets). Ids, owner and status are minted server-side. */
export const AssetCreateRequestSchema = z.object({
    name: z.string().min(1).max(160),
    category: AssetCategorySchema,
    isCar: z.boolean().optional(),
    priceIncGst: z.number().min(0),
    gstOnPrice: z.number().min(0).optional(),
    businessUsePercent: z.number().min(0).max(100).optional(),
    purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    firstUsedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    receiptId: z.string().nullish(),
    ledgerAccountCode: z.string().max(40).nullish(),
    notes: z.string().max(2000).nullish(),
});
export interface AssetCreateRequest {
    name: string;
    category: AssetCategory;
    isCar?: boolean;
    priceIncGst: number;
    gstOnPrice?: number;
    businessUsePercent?: number;
    purchaseDate: string;
    firstUsedDate?: string | null;
    receiptId?: string | null;
    ledgerAccountCode?: string | null;
    notes?: string | null;
}

/** Fields `AssetPgRepo.update` accepts; everything else in the patch is ignored. */
export const AssetUpdateRequestSchema = z.object({
    name: z.string().min(1).max(160).optional(),
    category: AssetCategorySchema.optional(),
    isCar: z.boolean().optional(),
    priceIncGst: z.number().min(0).optional(),
    gstOnPrice: z.number().min(0).optional(),
    businessUsePercent: z.number().min(0).max(100).optional(),
    purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    firstUsedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    ledgerAccountCode: z.string().max(40).nullish(),
    notes: z.string().max(2000).nullish(),
    costAdditions: z.array(AssetCostAdditionSchema).optional(),
    businessUseReviews: z.array(AssetBusinessUseReviewSchema).optional(),
});
export interface AssetUpdateRequest {
    name?: string;
    category?: AssetCategory;
    isCar?: boolean;
    priceIncGst?: number;
    gstOnPrice?: number;
    businessUsePercent?: number;
    purchaseDate?: string;
    firstUsedDate?: string | null;
    ledgerAccountCode?: string | null;
    notes?: string | null;
    costAdditions?: AssetCostAddition[];
    businessUseReviews?: AssetBusinessUseReview[];
}
