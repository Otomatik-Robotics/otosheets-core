import { and, eq, desc, lt, or, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { assets } from '../pg/schema/bookkeeping';
import { keysetFromStartKey, keysetStartKey } from '../pg/cursor';
import type { AssetDTO, AssetDisposal, AssetStatus, AssetUpdateRequest } from './schema';

/**
 * Every asset attribute `update` may set. Keyed by DTO name → Drizzle column;
 * anything not listed is ignored, so callers can't write unknown columns.
 * `status` and `disposal` are deliberately absent — they move only through
 * `dispose`, which is conditional on the current status.
 */
const SETTABLE: Record<string, keyof typeof assets.$inferInsert> = {
    name: 'name',
    category: 'category',
    isCar: 'isCar',
    priceIncGst: 'priceIncGst',
    gstOnPrice: 'gstOnPrice',
    businessUsePercent: 'businessUsePercent',
    purchaseDate: 'purchaseDate',
    firstUsedDate: 'firstUsedDate',
    ledgerAccountCode: 'ledgerAccountCode',
    notes: 'notes',
    costAdditions: 'costAdditions',
    businessUseReviews: 'businessUseReviews',
};

/** NUMERIC columns arrive as strings; the DTO carries numbers. */
const NUMERIC_KEYS = new Set(['priceIncGst', 'gstOnPrice', 'businessUsePercent']);

function toDto(row: typeof assets.$inferSelect): AssetDTO {
    const dto: Record<string, unknown> = {
        assetId: row.assetId,
        orgId: row.orgId,
        ownerId: row.ownerId,
        name: row.name,
        category: row.category,
        isCar: row.isCar,
        priceIncGst: Number(row.priceIncGst),
        gstOnPrice: Number(row.gstOnPrice),
        businessUsePercent: Number(row.businessUsePercent),
        purchaseDate: row.purchaseDate,
        firstUsedDate: row.firstUsedDate ?? null,
        receiptId: row.receiptId ?? null,
        status: row.status,
        disposal: row.disposal ?? null,
        costAdditions: Array.isArray(row.costAdditions) ? row.costAdditions : [],
        businessUseReviews: Array.isArray(row.businessUseReviews) ? row.businessUseReviews : [],
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
    if (row.businessProfileId != null) dto.businessProfileId = row.businessProfileId;
    if (row.createdBy != null) dto.createdBy = row.createdBy;
    if (row.ledgerAccountCode != null) dto.ledgerAccountCode = row.ledgerAccountCode;
    if (row.notes != null) dto.notes = row.notes;
    return dto as unknown as AssetDTO;
}

function toRow(a: AssetDTO): typeof assets.$inferInsert {
    return {
        assetId: a.assetId,
        orgId: a.orgId,
        businessProfileId: a.businessProfileId ?? null,
        ownerId: a.ownerId,
        createdBy: a.createdBy ?? null,
        name: a.name,
        category: a.category,
        isCar: a.isCar,
        priceIncGst: String(a.priceIncGst),
        gstOnPrice: String(a.gstOnPrice),
        businessUsePercent: String(a.businessUsePercent),
        purchaseDate: a.purchaseDate,
        firstUsedDate: a.firstUsedDate ?? null,
        receiptId: a.receiptId ?? null,
        ledgerAccountCode: a.ledgerAccountCode ?? null,
        notes: a.notes ?? null,
        status: a.status,
        disposal: a.disposal ?? null,
        costAdditions: a.costAdditions ?? [],
        businessUseReviews: a.businessUseReviews ?? [],
        // Written from the DTO (millisecond precision) rather than left to
        // now() — the keyset cursor round-trips created_at through an ISO
        // string, and a microsecond default would never compare equal again.
        createdAt: new Date(a.createdAt),
        updatedAt: new Date(a.updatedAt),
    };
}

export type AssetCreateResult = 'created' | 'duplicate_id' | 'receipt_already_promoted';
export type AssetDisposeResult = 'disposed' | 'already_disposed' | 'not_found';

export interface ListAssetsPaginatedParams {
    orgId: string;
    status?: AssetStatus;
    limit?: number;
    /** Already-decoded cursor from a prior page's `lastEvaluatedKey`. */
    exclusiveStartKey?: Record<string, any>;
}

export interface AssetsPage {
    items: AssetDTO[];
    /** Base64-wrapped by the handler into the opaque `nextToken`. */
    lastEvaluatedKey?: Record<string, any>;
}

const isUniqueViolation = (err: unknown): boolean =>
    Boolean(err && typeof err === 'object'
        && ((err as any).code === '23505' || (err as any).cause?.code === '23505'
            || /duplicate key|UNIQUE constraint/i.test(String((err as any).message ?? ''))));

/**
 * AssetPgRepo — Postgres-only (no Dynamo mirror; see pg/schema/bookkeeping.ts).
 * The asset register behind the depreciation schedule and the BAS capital
 * figures.
 */
export class AssetPgRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    /**
     * Conditional create — assetId is caller-minted, so a POST retry is a
     * no-op ('duplicate_id'). Promoting a receipt that already became an asset
     * trips the (org_id, receipt_id) unique index and surfaces as
     * 'receipt_already_promoted' rather than a 500; `getByReceipt` finds the
     * winner.
     */
    async createConditional(asset: AssetDTO): Promise<AssetCreateResult> {
        try {
            const rows = await this.db.insert(assets)
                .values(toRow(asset))
                .onConflictDoNothing({ target: assets.assetId })
                .returning({ assetId: assets.assetId });
            return rows.length > 0 ? 'created' : 'duplicate_id';
        } catch (err) {
            if (isUniqueViolation(err)) return 'receipt_already_promoted';
            throw err;
        }
    }

    async get(orgId: string, assetId: string): Promise<AssetDTO | null> {
        const rows = await this.db.select().from(assets)
            .where(and(eq(assets.orgId, orgId), eq(assets.assetId, assetId)))
            .limit(1);
        return rows[0] ? toDto(rows[0]) : null;
    }

    /** The asset a receipt was promoted to, if any. */
    async getByReceipt(orgId: string, receiptId: string): Promise<AssetDTO | null> {
        const rows = await this.db.select().from(assets)
            .where(and(eq(assets.orgId, orgId), eq(assets.receiptId, receiptId)))
            .limit(1);
        return rows[0] ? toDto(rows[0]) : null;
    }

    /** Newest-first keyset pagination on (created_at, asset_id) — same opaque cursor contract as the other pg lists. */
    async listPaginated(params: ListAssetsPaginatedParams): Promise<AssetsPage> {
        const limit = params.limit ?? 20;
        const conds: any[] = [eq(assets.orgId, params.orgId)];
        if (params.status) conds.push(eq(assets.status, params.status));
        const cursor = keysetFromStartKey(params.exclusiveStartKey, 'assetId');
        if (cursor) {
            const at = new Date(cursor.createdAt);
            conds.push(or(
                lt(assets.createdAt, at),
                and(eq(assets.createdAt, at), lt(assets.assetId, cursor.id)),
            ));
        }
        const rows = await this.db.select().from(assets)
            .where(and(...conds))
            .orderBy(desc(assets.createdAt), desc(assets.assetId))
            .limit(limit);
        const last = rows[rows.length - 1];
        return {
            items: rows.map(toDto),
            lastEvaluatedKey: rows.length === limit && last
                ? keysetStartKey({ createdAt: last.createdAt.toISOString(), id: last.assetId })
                : undefined,
        };
    }

    /**
     * Every asset of the org, for the depreciation schedule — pages through
     * `listPaginated` 500 at a time until the cursor runs out. Disposed assets
     * are included: the schedule needs them for their disposal year.
     */
    async listAllForSchedule(orgId: string): Promise<AssetDTO[]> {
        const out: AssetDTO[] = [];
        let exclusiveStartKey: Record<string, any> | undefined;
        do {
            const page = await this.listPaginated({ orgId, limit: 500, exclusiveStartKey });
            out.push(...page.items);
            exclusiveStartKey = page.lastEvaluatedKey;
        } while (exclusiveStartKey);
        return out;
    }

    /** Patch through the SETTABLE allowlist, bumping updated_at. False when the asset doesn't exist. */
    async update(orgId: string, assetId: string, updates: AssetUpdateRequest | Record<string, any>): Promise<boolean> {
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        for (const [k, v] of Object.entries(updates)) {
            const col = SETTABLE[k];
            if (!col || v === undefined) continue;
            patch[col] = NUMERIC_KEYS.has(k) && typeof v === 'number' ? String(v) : v;
        }
        const rows = await this.db.update(assets)
            .set(patch as any)
            .where(and(eq(assets.orgId, orgId), eq(assets.assetId, assetId)))
            .returning({ assetId: assets.assetId });
        return rows.length > 0;
    }

    /**
     * Record the disposal and flip to DISPOSED — conditional on the asset still
     * being ACTIVE, so a retried "dispose" cannot overwrite the first disposal's
     * facts ('already_disposed').
     */
    async dispose(orgId: string, assetId: string, disposal: AssetDisposal): Promise<AssetDisposeResult> {
        const rows = await this.db.update(assets)
            .set({ status: 'DISPOSED', disposal, updatedAt: new Date() })
            .where(and(eq(assets.orgId, orgId), eq(assets.assetId, assetId), eq(assets.status, 'ACTIVE')))
            .returning({ assetId: assets.assetId });
        if (rows.length > 0) return 'disposed';
        const existing = await this.get(orgId, assetId);
        return existing ? 'already_disposed' : 'not_found';
    }

    /** Hard delete. */
    async remove(orgId: string, assetId: string): Promise<boolean> {
        const rows = await this.db.delete(assets)
            .where(and(eq(assets.orgId, orgId), eq(assets.assetId, assetId)))
            .returning({ assetId: assets.assetId });
        return rows.length > 0;
    }

    /** ACTIVE assets whose first-used date is still unknown — depreciation cannot start for these. */
    async countWithoutFirstUse(orgId: string): Promise<number> {
        const rows = await this.db.select({ n: sql<number>`count(*)::int` }).from(assets)
            .where(and(eq(assets.orgId, orgId), eq(assets.status, 'ACTIVE'), sql`${assets.firstUsedDate} IS NULL`));
        return Number(rows[0]?.n ?? 0);
    }

    async countActive(orgId: string): Promise<number> {
        const rows = await this.db.select({ n: sql<number>`count(*)::int` }).from(assets)
            .where(and(eq(assets.orgId, orgId), eq(assets.status, 'ACTIVE')));
        return Number(rows[0]?.n ?? 0);
    }
}
