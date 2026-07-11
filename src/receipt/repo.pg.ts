import { and, eq, sql, desc, lt, or, gte, lte, notInArray } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { receipts } from '../pg/schema/opsEntities';
import { keysetFromStartKey, keysetStartKey } from '../pg/cursor';
import { dtoToRow, rowToDto, ownerFromSk } from '../pg/billingRows';
import { PaginatedResult } from '../types';
import { Receipt } from './schema';
import type { IReceiptRepo } from './repo';

const NUM = ['totalAmount', 'taxAmount', 'gstAmount', 'exGstAmount', 'businessPercent', 'businessAmount'];
const PG_ONLY = ['ownerId'];
const STRIP = ['sk', 'dateSk'];
function toDto(row: any): Receipt {
    const d = rowToDto<any>(row, NUM, PG_ONLY);
    d.sk = `${row.ownerId}#${row.receiptId}`;
    if (row.date) d.dateSk = `${row.date}#${row.receiptId}`;
    return d as Receipt;
}

function round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Shared filter set for the Expenses list + summary (excludes DUPLICATE/ARCHIVED). */
export interface ReceiptListFilters {
    orgId: string;
    /** Optional business-profile scope (multi-profile isolation). */
    businessProfileId?: string;
    /** Case-insensitive match on vendor name OR description. */
    search?: string;
    category?: string;
    /** Inclusive YYYY-MM-DD bounds on the receipt date. */
    dateFrom?: string;
    dateTo?: string;
}

export interface ListReceiptsPaginatedParams extends ReceiptListFilters {
    limit?: number;
    /** Already-decoded keyset cursor `{ date, id }` from a prior page. */
    exclusiveStartKey?: Record<string, any>;
}

export interface ReceiptsPage {
    items: Receipt[];
    /** Base64-wrapped by the handler into the opaque `nextToken`. */
    lastEvaluatedKey?: Record<string, any>;
    /** Count of the full filtered set (not just this page). */
    total: number;
}

export interface ReceiptCategoryAgg {
    category: string;
    amount: number;
    count: number;
}

export interface ReceiptSummary {
    count: number;
    totalAmount: number;
    totalGst: number;
    deductibleAmount: number;
    highRiskCount: number;
    categories: ReceiptCategoryAgg[];
}

export class ReceiptPgRepo implements IReceiptRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    async getReceipt(o: string, _u: string, id: string) { const r = await this.db.select().from(receipts).where(and(eq(receipts.orgId, o), eq(receipts.receiptId, id))).limit(1); return r[0] ? toDto(r[0]) : null; }
    async findReceiptByIdInOrg(o: string, id: string) { const r = await this.db.select().from(receipts).where(and(eq(receipts.orgId, o), eq(receipts.receiptId, id))).limit(1); return r[0] ? { receipt: toDto(r[0]), ownerId: (r[0] as any).ownerId } : null; }
    async findReceiptByDescriptionPrefix(o: string, prefix: string) { const r = await this.db.select().from(receipts).where(and(eq(receipts.orgId, o), sql`${receipts.description} LIKE ${prefix + '%'}`)).orderBy(desc(receipts.createdAt)).limit(1); return r[0] ? toDto(r[0]) : null; }
    async findReceiptByContentHash(o: string, contentHash: string) { const r = await this.db.select().from(receipts).where(and(eq(receipts.orgId, o), eq(receipts.contentHash, contentHash), notInArray(receipts.status, ['ARCHIVED', 'DUPLICATE']))).orderBy(desc(receipts.createdAt)).limit(1); return r[0] ? toDto(r[0]) : null; }
    async findReceiptsByDuplicateOf(o: string, receiptId: string) { return (await this.db.select().from(receipts).where(and(eq(receipts.orgId, o), eq(receipts.duplicateOf, receiptId)))).map(toDto); }
    async findReceiptsByVendorAndAmount(o: string, vendorName: string, amount: number) { return (await this.db.select().from(receipts).where(and(eq(receipts.orgId, o), eq(receipts.vendorName, vendorName), eq(receipts.totalAmount, String(amount))))).map(toDto); }
    async listAllOrgReceipts(o: string) { return (await this.db.select().from(receipts).where(eq(receipts.orgId, o))).map(toDto); }
    async listUserReceipts(o: string, userId: string) { return (await this.db.select().from(receipts).where(and(eq(receipts.orgId, o), eq(receipts.ownerId, userId)))).map(toDto); }
    async listReceiptsByDate(o: string, from: string, to: string, _projection?: string) { return (await this.db.select().from(receipts).where(and(eq(receipts.orgId, o), gte(receipts.date, from), lte(receipts.date, to)))).map(toDto); }
    async createReceipt(o: string, u: string, id: string, data: Record<string, any>) { await this.db.insert(receipts).values({ ...dtoToRow(data, NUM, STRIP), orgId: o, receiptId: id, ownerId: u, createdBy: u, createdAt: new Date() } as any); }
    async updateReceipt(o: string, _u: string, id: string, upd: Record<string, any>) { await this.db.update(receipts).set(dtoToRow(upd, NUM, STRIP) as any).where(and(eq(receipts.orgId, o), eq(receipts.receiptId, id))); }
    async deleteReceipt(o: string, _u: string, id: string) { await this.db.delete(receipts).where(and(eq(receipts.orgId, o), eq(receipts.receiptId, id))); }
    async upsertReceipt(receipt: Receipt) { const row = { ...dtoToRow(receipt as Record<string, any>, NUM, STRIP), ownerId: ownerFromSk(receipt as any) }; await this.db.insert(receipts).values(row as any).onConflictDoUpdate({ target: receipts.receiptId, set: row as any }); }

    /** Shared WHERE for list + summary. Mirrors the Dynamo DateIndex semantics:
     *  scoped to org, DUPLICATE/ARCHIVED excluded, and (for the date-ordered
     *  list) only dated receipts — pending/undated rows are absent from the
     *  sparse DateIndex on Dynamo, so we keep that parity. */
    private listConds(f: ReceiptListFilters, requireDate: boolean): any[] {
        const conds: any[] = [
            eq(receipts.orgId, f.orgId),
            notInArray(receipts.status, ['DUPLICATE', 'ARCHIVED']),
        ];
        if (requireDate) conds.push(sql`${receipts.date} IS NOT NULL`);
        if (f.businessProfileId) conds.push(eq(receipts.businessProfileId, f.businessProfileId));
        if (f.search) {
            const like = `%${f.search}%`;
            conds.push(or(sql`${receipts.vendorName} ILIKE ${like}`, sql`${receipts.description} ILIKE ${like}`));
        }
        if (f.category) conds.push(eq(receipts.category, f.category));
        if (f.dateFrom) conds.push(gte(receipts.date, f.dateFrom));
        if (f.dateTo) conds.push(lte(receipts.date, f.dateTo));
        return conds;
    }

    /** Paginated Expenses list — newest receipt date first, keyset on (date, receiptId).
     *  Returns the full-filtered-set `total` alongside the page (parity with the
     *  Dynamo handler's COUNT query). */
    async listReceiptsPaginated(params: ListReceiptsPaginatedParams): Promise<ReceiptsPage> {
        const limit = params.limit ?? 20;
        const conds = this.listConds(params, true);
        const where = and(...conds);

        // Total over the full filtered set — runs in parallel with the page query.
        const countPromise = this.db
            .select({ c: sql<number>`count(*)::int` })
            .from(receipts)
            .where(where);

        const pageConds = [...conds];
        const cursor = params.exclusiveStartKey;
        if (cursor?.date && cursor?.id) {
            pageConds.push(or(
                lt(receipts.date, cursor.date as string),
                and(eq(receipts.date, cursor.date as string), lt(receipts.receiptId, cursor.id as string)),
            ));
        }

        const rows = await this.db.select().from(receipts)
            .where(and(...pageConds))
            .orderBy(desc(receipts.date), desc(receipts.receiptId))
            .limit(limit);

        const countRes = await countPromise;
        const total = Number(countRes[0]?.c ?? 0);

        const last = rows[rows.length - 1] as any;
        const lastEvaluatedKey = rows.length === limit && last
            ? { date: last.date, id: last.receiptId }
            : undefined;

        return { items: rows.map(toDto), lastEvaluatedKey, total };
    }

    /** Aggregate summary for the Expenses bento tiles — all reductions in SQL
     *  (no in-memory scan). Deductible amount honours businessAmount, falling
     *  back to totalAmount × businessPercent%. */
    async summarizeReceipts(params: ReceiptListFilters): Promise<ReceiptSummary> {
        // requireDate: true — parity with the Dynamo summary handler, which reads
        // the sparse DateIndex and so only aggregates dated receipts.
        const where = and(...this.listConds(params, true));

        const totalsPromise = this.db.select({
            count: sql<number>`count(*)::int`,
            totalAmount: sql<string>`coalesce(sum(${receipts.totalAmount}), 0)`,
            totalGst: sql<string>`coalesce(sum(coalesce(${receipts.taxAmount}, ${receipts.gstAmount})), 0)`,
            deductibleAmount: sql<string>`coalesce(sum(case when ${receipts.isDeductible} then coalesce(${receipts.businessAmount}, ${receipts.totalAmount} * coalesce(${receipts.businessPercent}, 100) / 100) else 0 end), 0)`,
            highRiskCount: sql<number>`(count(*) filter (where upper(${receipts.aiRiskLevel}) = 'HIGH'))::int`,
        }).from(receipts).where(where);

        const catExpr = sql<string>`coalesce(${receipts.category}, 'UNCATEGORIZED')`;
        const catsPromise = this.db.select({
            category: catExpr,
            amount: sql<string>`coalesce(sum(${receipts.totalAmount}), 0)`,
            count: sql<number>`count(*)::int`,
        }).from(receipts).where(where).groupBy(catExpr).orderBy(sql`coalesce(sum(${receipts.totalAmount}), 0) desc`);

        const [totalsRes, catsRes] = await Promise.all([totalsPromise, catsPromise]);
        const t = totalsRes[0];
        return {
            count: Number(t?.count ?? 0),
            totalAmount: round2(Number(t?.totalAmount ?? 0)),
            totalGst: round2(Number(t?.totalGst ?? 0)),
            deductibleAmount: round2(Number(t?.deductibleAmount ?? 0)),
            highRiskCount: Number(t?.highRiskCount ?? 0),
            categories: catsRes.map(c => ({ category: c.category, amount: round2(Number(c.amount)), count: Number(c.count) })),
        };
    }
}
