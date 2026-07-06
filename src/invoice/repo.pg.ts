import { and, eq, sql, desc, lt, or, inArray, gte, lte } from 'drizzle-orm';
import { getPg, getPgTx, type PgDb } from '../pg/client';
import { invoices, invoiceLineItems } from '../pg/schema/billingCore';
import { keysetFromStartKey, keysetStartKey } from '../pg/cursor';
import { PaginatedResult } from '../types';
import { Invoice } from './schema';
import { composeInvoiceSummary, type InvoiceSummary, type InvoiceSummaryBucket } from './summary';
import type { IInvoiceRepo, ListInvoicesPaginatedParams } from './repo';

// Money/number columns returned as strings by pg → numbers in the DTO.
const NUMERIC_KEYS = ['subtotal', 'gstAmount', 'totalAmount', 'taxRate', 'paidAmount'];
// Columns that exist in pg but are NOT surfaced directly under the same DTO key
// (ownerId is internal; the legacy_* columns are remapped to their DTO aliases).
const PG_ONLY = new Set(['ownerId', 'legacyClientSnapshot', 'legacyLineItems']);

interface LineItemRow {
    lineItemId: string; description: string;
    quantity: string | null; unitPrice: string | null; total: string | null; sortOrder: number;
}

function itemFromRow(r: LineItemRow) {
    const item: any = { id: r.lineItemId, description: r.description, sortOrder: r.sortOrder };
    if (r.quantity != null) item.quantity = Number(r.quantity);
    if (r.unitPrice != null) item.unitPrice = Number(r.unitPrice);
    if (r.total != null) item.total = Number(r.total);
    return item;
}

/** Row + its line items → the Dynamo-shaped Invoice DTO (reconstructs sk, dueDateSk, items, clientSnapshot). */
function toInvoiceDto(row: any, items: LineItemRow[]): Invoice {
    const dto: any = {};
    for (const [k, v] of Object.entries(row)) {
        if (PG_ONLY.has(k) || v === null) continue;
        if (v instanceof Date) dto[k] = v.toISOString();
        else if (NUMERIC_KEYS.includes(k) && typeof v === 'string') dto[k] = Number(v);
        else dto[k] = v;
    }
    // Storage fields Dynamo carries that pg derives:
    dto.sk = `${row.ownerId}#${row.invoiceId}`;
    if (row.dueDate) dto.dueDateSk = `${row.dueDate}#${row.invoiceId}`;
    if (row.legacyClientSnapshot != null) dto.clientSnapshot = row.legacyClientSnapshot;
    if (row.legacyLineItems != null) dto.lineItems = row.legacyLineItems;
    dto.items = items.map(itemFromRow);
    return dto as Invoice;
}

// timestamptz columns need a Date, not the ISO string Dynamo stores.
const TS_KEYS = new Set(['createdAt', 'updatedAt']);

/** Invoice DTO → column row (strips sk/dueDateSk/items/clientSnapshot; derives owner_id). */
function toInvoiceRow(invoice: Record<string, any>): Record<string, any> {
    const { sk, dueDateSk, items, clientSnapshot, lineItems, ...rest } = invoice;
    const ownerId = typeof sk === 'string' ? sk.split('#')[0] : (rest.createdBy ?? '');
    const row: Record<string, any> = { ownerId };
    if (clientSnapshot !== undefined) row.legacyClientSnapshot = clientSnapshot ?? null;
    if (lineItems !== undefined) row.legacyLineItems = lineItems ?? null;
    for (const [k, v] of Object.entries(rest)) {
        if (v === undefined) continue;
        if (v === null) { row[k] = null; }
        else if (TS_KEYS.has(k) && typeof v === 'string') row[k] = new Date(v);
        else if (NUMERIC_KEYS.includes(k) && typeof v === 'number') row[k] = String(v);
        else row[k] = v;
    }
    return row;
}

function itemRows(invoiceId: string, items: any[]): any[] {
    return (items ?? []).map((it, i) => ({
        lineItemId: it.id ?? `${invoiceId}#${i}`,
        invoiceId,
        description: it.description ?? '',
        quantity: it.quantity != null ? String(it.quantity) : null,
        unitPrice: it.unitPrice != null ? String(it.unitPrice) : null,
        total: it.total != null ? String(it.total) : null,
        sortOrder: it.sortOrder ?? i,
    }));
}

export class InvoicePgRepo implements IInvoiceRepo {
    constructor(private injected?: PgDb, private injectedTx?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }
    private get tx(): PgDb { return this.injectedTx ?? this.injected ?? getPgTx(); }

    private async itemsByInvoice(invoiceIds: string[]): Promise<Map<string, LineItemRow[]>> {
        const map = new Map<string, LineItemRow[]>();
        if (invoiceIds.length === 0) return map;
        const rows = await this.db.select().from(invoiceLineItems)
            .where(inArray(invoiceLineItems.invoiceId, invoiceIds))
            .orderBy(invoiceLineItems.sortOrder);
        for (const r of rows as any[]) {
            const list = map.get(r.invoiceId) ?? [];
            list.push(r);
            map.set(r.invoiceId, list);
        }
        return map;
    }

    private async hydrate(rows: any[]): Promise<Invoice[]> {
        const itemsMap = await this.itemsByInvoice(rows.map(r => r.invoiceId));
        return rows.map(r => toInvoiceDto(r, itemsMap.get(r.invoiceId) ?? []));
    }

    async getInvoice(orgId: string, _userId: string, invoiceId: string): Promise<Invoice | null> {
        const rows = await this.db.select().from(invoices)
            .where(and(eq(invoices.orgId, orgId), eq(invoices.invoiceId, invoiceId))).limit(1);
        if (!rows[0]) return null;
        return (await this.hydrate(rows))[0];
    }

    async findInvoiceByIdInOrg(orgId: string, invoiceId: string): Promise<{ invoice: Invoice; ownerId: string } | null> {
        const rows = await this.db.select().from(invoices)
            .where(and(eq(invoices.orgId, orgId), eq(invoices.invoiceId, invoiceId))).limit(1);
        if (!rows[0]) return null;
        const invoice = (await this.hydrate(rows))[0];
        return { invoice, ownerId: (rows[0] as any).ownerId };
    }

    async listOrgInvoicesPaginated(params: ListInvoicesPaginatedParams): Promise<PaginatedResult<Invoice>> {
        const { orgId, limit = 20, exclusiveStartKey, status, isQuote, isRecurring, isPaymentLink, clientId, search, dueDateFrom, dueDateTo } = params;
        const conds: any[] = [eq(invoices.orgId, orgId)];

        // isPaymentLink: default excludes them (legacy-safe: null counts as not-a-link)
        if (isPaymentLink === true) conds.push(eq(invoices.isPaymentLink, true));
        else conds.push(or(sql`${invoices.isPaymentLink} IS NULL`, eq(invoices.isPaymentLink, false)));

        if (isRecurring === true) conds.push(eq(invoices.isRecurring, true));
        else if (isRecurring === false) conds.push(or(sql`${invoices.isRecurring} IS NULL`, eq(invoices.isRecurring, false)));

        if (isQuote === true) conds.push(eq(invoices.isQuote, true));
        else if (isQuote === false) conds.push(or(sql`${invoices.isQuote} IS NULL`, eq(invoices.isQuote, false)));

        if (status) conds.push(eq(invoices.status, status));
        if (clientId) conds.push(eq(invoices.clientId, clientId));
        if (search) {
            const like = `%${search}%`;
            conds.push(or(sql`${invoices.invoiceNumber} ILIKE ${like}`, sql`${invoices.notes} ILIKE ${like}`));
        }
        if (dueDateFrom) conds.push(gte(invoices.dueDate, dueDateFrom));
        if (dueDateTo) conds.push(lte(invoices.dueDate, dueDateTo));

        const cursor = keysetFromStartKey(exclusiveStartKey, 'invoiceId');
        if (cursor) {
            conds.push(or(
                lt(invoices.createdAt, new Date(cursor.createdAt)),
                and(eq(invoices.createdAt, new Date(cursor.createdAt)), lt(invoices.invoiceId, cursor.id)),
            ));
        }

        const rows = await this.db.select().from(invoices)
            .where(and(...conds))
            .orderBy(desc(invoices.createdAt), desc(invoices.invoiceId))
            .limit(limit);

        const items = await this.hydrate(rows);
        const last = rows[rows.length - 1] as any;
        const lastEvaluatedKey = rows.length === limit && last
            ? keysetStartKey({ createdAt: (last.createdAt as Date).toISOString(), id: last.invoiceId })
            : undefined;
        return { items, lastEvaluatedKey };
    }

    async listUserInvoices(orgId: string, userId: string): Promise<Invoice[]> {
        const rows = await this.db.select().from(invoices)
            .where(and(eq(invoices.orgId, orgId), eq(invoices.ownerId, userId)));
        return this.hydrate(rows);
    }

    async listInvoicesByDate(orgId: string, from: string, to: string): Promise<Invoice[]> {
        const rows = await this.db.select().from(invoices)
            .where(and(eq(invoices.orgId, orgId), gte(invoices.date, from), lte(invoices.date, to)));
        return this.hydrate(rows);
    }

    async listAllOrgInvoices(orgId: string): Promise<Invoice[]> {
        const rows = await this.db.select().from(invoices).where(eq(invoices.orgId, orgId));
        return this.hydrate(rows);
    }

    async listDraftInvoices(orgId: string): Promise<Invoice[]> {
        const rows = await this.db.select().from(invoices)
            .where(and(eq(invoices.orgId, orgId), eq(invoices.status, 'DRAFT'),
                or(sql`${invoices.isPaymentLink} IS NULL`, eq(invoices.isPaymentLink, false))));
        return this.hydrate(rows);
    }

    async listOverdueInvoices(orgId: string, beforeDate: string): Promise<Invoice[]> {
        const rows = await this.db.select().from(invoices)
            .where(and(eq(invoices.orgId, orgId), lt(invoices.dueDate, beforeDate),
                inArray(invoices.status, ['SENT', 'PARTIAL', 'OVERDUE'])));
        return this.hydrate(rows);
    }

    async getInvoiceSummary(orgId: string): Promise<InvoiceSummary> {
        // One GROUP BY over (status, past-due) — the org_status_due index backs it.
        // Past-due is derived here, not read from a maintained counter.
        const today = new Date().toISOString().slice(0, 10);
        // Raw, unqualified column text (single table in FROM) so the expression is
        // byte-identical in SELECT and GROUP BY — Postgres matches grouped
        // expressions textually, and drizzle qualifies column refs inconsistently
        // across the two clauses.
        const pastDue = sql<boolean>`(due_date is not null and due_date < ${today})`;
        const rows = await this.db
            .select({
                status: invoices.status,
                isPastDue: pastDue,
                count: sql<number>`count(*)::int`,
                totalAmount: sql<string>`coalesce(sum(${invoices.totalAmount}), 0)`,
                paidAmount: sql<string>`coalesce(sum(${invoices.paidAmount}), 0)`,
            })
            .from(invoices)
            .where(and(
                eq(invoices.orgId, orgId),
                or(sql`${invoices.isPaymentLink} IS NULL`, eq(invoices.isPaymentLink, false)),
                or(sql`${invoices.isQuote} IS NULL`, eq(invoices.isQuote, false)),
            ))
            // Group by select-list ordinals (status = 1, past-due expr = 2): avoids
            // re-emitting the parameterized expression, which Postgres would treat
            // as a distinct expression ($1 vs $5) and reject.
            .groupBy(sql`1`, sql`2`);

        const buckets: InvoiceSummaryBucket[] = (rows as any[]).map((r) => ({
            status: r.status ?? 'DRAFT',
            isPastDue: r.isPastDue === true || r.isPastDue === 't' || r.isPastDue === 1,
            count: Number(r.count) || 0,
            totalAmount: Number(r.totalAmount) || 0,
            paidAmount: Number(r.paidAmount) || 0,
        }));
        return composeInvoiceSummary(buckets);
    }

    async createInvoice(orgId: string, userId: string, invoiceId: string, data: Record<string, any>): Promise<void> {
        const now = new Date();
        const { items, ...rest } = data;
        const row = { ...toInvoiceRow(rest), invoiceId, orgId, ownerId: userId, createdBy: userId, createdAt: now, updatedAt: now };
        await (this.tx as any).transaction(async (tx: any) => {
            await tx.insert(invoices).values(row);
            const lines = itemRows(invoiceId, items);
            if (lines.length > 0) await tx.insert(invoiceLineItems).values(lines);
        });
    }

    async updateInvoice(orgId: string, userId: string, invoiceId: string, updates: Record<string, any>): Promise<void> {
        const { items, ...rest } = updates;
        await (this.tx as any).transaction(async (tx: any) => {
            const res = await tx.update(invoices)
                .set({ ...toInvoiceRow(rest), updatedAt: new Date() })
                .where(and(eq(invoices.orgId, orgId), eq(invoices.invoiceId, invoiceId)))
                .returning({ id: invoices.invoiceId });
            // Parity with the Dynamo ConditionExpression: never upsert on update.
            if (res.length === 0) throw new Error(`invoice ${invoiceId} not found (update must not upsert)`);
            if (items !== undefined) {
                await tx.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));
                const lines = itemRows(invoiceId, items);
                if (lines.length > 0) await tx.insert(invoiceLineItems).values(lines);
            }
        });
    }

    async deleteInvoice(orgId: string, _userId: string, invoiceId: string): Promise<void> {
        await this.db.delete(invoices).where(and(eq(invoices.orgId, orgId), eq(invoices.invoiceId, invoiceId)));
    }

    /** Full-entity mirror upsert — last-writer-wins on updatedAt (§6.1); replaces line items. */
    async upsertInvoice(invoice: Invoice): Promise<void> {
        const { items, ...rest } = invoice as Record<string, any>;
        const row = toInvoiceRow(rest);
        await (this.tx as any).transaction(async (tx: any) => {
            await tx.insert(invoices).values(row)
                .onConflictDoUpdate({ target: invoices.invoiceId, set: row, setWhere: sql`${invoices.updatedAt} <= excluded.updated_at` });
            // Refresh line items to match (idempotent).
            await tx.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, (invoice as any).invoiceId));
            const lines = itemRows((invoice as any).invoiceId, items);
            if (lines.length > 0) await tx.insert(invoiceLineItems).values(lines);
        });
    }
}
