import { and, eq, desc, lt, or, gte, lte, inArray, sql, isNull } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { shopOrders, shopOrderCounters } from '../pg/schema/commerce';
import { Order, OrderStatus } from './schema';
import type { IOrderRepo } from './repo';

/** Whitelisted extra attributes updateStatus may set — mapped DTO key → column. */
const SETTABLE: Record<string, keyof typeof shopOrders.$inferInsert> = {
    fulfilment: 'fulfilment',
    refund: 'refund',
    linkedInvoiceId: 'linkedInvoiceId',
    stripePaymentIntentId: 'stripePaymentIntentId',
    businessProfileId: 'businessProfileId',
};

function toDto(row: typeof shopOrders.$inferSelect): Order {
    const dto: Record<string, unknown> = {
        orgId: row.orgId, orderId: row.orderId, orderNumber: row.orderNumber,
        status: row.status as OrderStatus, buyer: row.buyer, lines: row.lines,
        subtotalCents: row.subtotalCents, shippingCents: row.shippingCents,
        taxCents: row.taxCents, totalCents: row.totalCents, currency: row.currency,
        stripeSessionId: row.stripeSessionId,
        createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
    if (row.businessProfileId != null) dto.businessProfileId = row.businessProfileId;
    if (row.shippingAddress != null) dto.shippingAddress = row.shippingAddress;
    if (row.shippingOption != null) dto.shippingOption = row.shippingOption;
    if (row.stripePaymentIntentId != null) dto.stripePaymentIntentId = row.stripePaymentIntentId;
    if (row.linkedInvoiceId != null) dto.linkedInvoiceId = row.linkedInvoiceId;
    if (row.fulfilment != null) dto.fulfilment = row.fulfilment;
    if (row.refund != null) dto.refund = row.refund;
    if (row.receiptSentAt != null) dto.receiptSentAt = row.receiptSentAt;
    return dto as unknown as Order;
}

function toRow(o: Order): typeof shopOrders.$inferInsert {
    return {
        orgId: o.orgId, orderId: o.orderId, orderNumber: o.orderNumber,
        businessProfileId: o.businessProfileId ?? null,
        status: o.status, buyer: o.buyer,
        shippingAddress: o.shippingAddress ?? null,
        shippingOption: o.shippingOption ?? null,
        lines: o.lines,
        subtotalCents: o.subtotalCents ?? 0, shippingCents: o.shippingCents ?? 0,
        taxCents: o.taxCents ?? 0, totalCents: o.totalCents ?? 0,
        currency: o.currency ?? 'AUD',
        stripeSessionId: o.stripeSessionId,
        stripePaymentIntentId: o.stripePaymentIntentId ?? null,
        linkedInvoiceId: o.linkedInvoiceId ?? null,
        fulfilment: o.fulfilment ?? null, refund: o.refund ?? null,
        receiptSentAt: o.receiptSentAt ?? null,
        createdAt: o.createdAt, updatedAt: o.updatedAt,
    };
}

/** OrderPgRepo — the Postgres implementation (shop_orders + shop_order_counters). */
export class OrderPgRepo implements IOrderRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    async nextOrderNumber(orgId: string): Promise<number> {
        const rows = await this.db.insert(shopOrderCounters)
            .values({ orgId, seq: 1 })
            .onConflictDoUpdate({
                target: shopOrderCounters.orgId,
                set: { seq: sql`${shopOrderCounters.seq} + 1` },
            })
            .returning({ seq: shopOrderCounters.seq });
        return Number(rows[0]?.seq ?? 1);
    }

    async createConditional(order: Order): Promise<boolean> {
        const rows = await this.db.insert(shopOrders)
            .values(toRow(order))
            .onConflictDoNothing({ target: [shopOrders.orgId, shopOrders.orderId] })
            .returning({ orderId: shopOrders.orderId });
        return rows.length > 0; // 0 rows = webhook replay, already created
    }

    async get(orgId: string, orderId: string): Promise<Order | null> {
        const rows = await this.db.select().from(shopOrders)
            .where(and(eq(shopOrders.orgId, orgId), eq(shopOrders.orderId, orderId))).limit(1);
        return rows[0] ? toDto(rows[0]) : null;
    }

    /** Newest-first keyset pagination — same opaque lastEvaluatedKey contract as Dynamo. */
    async listByOrg(
        orgId: string,
        opts?: { limit?: number; exclusiveStartKey?: Record<string, any>; status?: OrderStatus },
    ): Promise<{ items: Order[]; lastEvaluatedKey?: Record<string, any> }> {
        const limit = opts?.limit ?? 20;
        const conds: any[] = [eq(shopOrders.orgId, orgId)];
        if (opts?.status) conds.push(eq(shopOrders.status, opts.status));
        const k = opts?.exclusiveStartKey;
        if (k?.createdAt && k?.orderId) {
            conds.push(or(
                lt(shopOrders.createdAt, String(k.createdAt)),
                and(eq(shopOrders.createdAt, String(k.createdAt)), lt(shopOrders.orderId, String(k.orderId))),
            ));
        }
        const rows = await this.db.select().from(shopOrders).where(and(...conds))
            .orderBy(desc(shopOrders.createdAt), desc(shopOrders.orderId)).limit(limit);
        const last = rows[rows.length - 1];
        return {
            items: rows.map(toDto),
            lastEvaluatedKey: rows.length === limit && last
                ? { orgId, orderId: last.orderId, createdAt: last.createdAt }
                : undefined,
        };
    }

    /** Per-day paid totals — native SQL GROUP BY (the reporting-layer way). */
    async dailyTotals(
        orgId: string,
        fromIso: string,
        toIso: string,
    ): Promise<{ day: string; orders: number; revenueCents: number }[]> {
        const day = sql<string>`substr(${shopOrders.createdAt}, 1, 10)`;
        const rows = await this.db.select({
            day,
            orders: sql<number>`count(*)`,
            revenueCents: sql<number>`coalesce(sum(${shopOrders.totalCents}), 0)`,
        }).from(shopOrders)
            .where(and(
                eq(shopOrders.orgId, orgId),
                gte(shopOrders.createdAt, fromIso),
                lte(shopOrders.createdAt, toIso),
                inArray(shopOrders.status, ['paid', 'fulfilled', 'shipped']),
            ))
            .groupBy(day)
            .orderBy(day);
        return rows.map(r => ({ day: r.day, orders: Number(r.orders), revenueCents: Number(r.revenueCents) }));
    }

    async updateStatus(
        orgId: string,
        orderId: string,
        expectedFrom: OrderStatus[],
        to: OrderStatus,
        set?: Record<string, any>,
    ): Promise<boolean> {
        const patch: Record<string, unknown> = { status: to, updatedAt: new Date().toISOString() };
        for (const [k, v] of Object.entries(set ?? {})) {
            const col = SETTABLE[k];
            if (col) patch[col] = v;
        }
        const rows = await this.db.update(shopOrders)
            .set(patch as any)
            .where(and(
                eq(shopOrders.orgId, orgId), eq(shopOrders.orderId, orderId),
                inArray(shopOrders.status, expectedFrom),
            ))
            .returning({ orderId: shopOrders.orderId });
        return rows.length > 0;
    }

    async claimReceiptSend(orgId: string, orderId: string): Promise<boolean> {
        const rows = await this.db.update(shopOrders)
            .set({ receiptSentAt: new Date().toISOString() })
            .where(and(
                eq(shopOrders.orgId, orgId), eq(shopOrders.orderId, orderId),
                isNull(shopOrders.receiptSentAt),
            ))
            .returning({ orderId: shopOrders.orderId });
        return rows.length > 0;
    }

    /** Mirror seam — last-writer-wins on updated_at, like the other dual domains. */
    async upsert(order: Order): Promise<void> {
        const row = toRow(order);
        await this.db.insert(shopOrders).values(row)
            .onConflictDoUpdate({
                target: [shopOrders.orgId, shopOrders.orderId],
                set: row as any,
                setWhere: sql`${shopOrders.updatedAt} <= excluded.updated_at`,
            });
    }

    /** Mirror seam — raise the counter to at least `seq`, never lower. */
    async syncOrderCounter(orgId: string, seq: number): Promise<void> {
        await this.db.insert(shopOrderCounters)
            .values({ orgId, seq })
            .onConflictDoUpdate({
                target: shopOrderCounters.orgId,
                set: { seq: sql`greatest(${shopOrderCounters.seq}, ${seq})` },
            });
    }
}
