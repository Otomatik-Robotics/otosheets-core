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
}
