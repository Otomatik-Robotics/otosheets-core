import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { Order, OrderStatus, ORDER_COUNTER_SK, ORDER_ORG_CREATED_INDEX } from './schema';

function isConditionalCancel(err: any): boolean {
    if (err?.name === 'ConditionalCheckFailedException') return true;
    if (err?.name !== 'TransactionCanceledException') return false;
    const reasons: any[] = err?.CancellationReasons ?? [];
    return reasons.some((r) => r?.Code === 'ConditionalCheckFailed');
}

/** Per-website scoping for order reads. `host` is the site host stamped at
 *  checkout; `includeUnattributed` also matches orders with NO siteHost (set it
 *  when the requested site is the org's PRIMARY site, so orders that predate
 *  multi-site attribution stay visible there). */
export interface OrderSiteScope { host: string; includeUnattributed?: boolean }

/** The order data contract — implemented by Dynamo + Postgres, routed by factory.ts. */
export interface IOrderRepo {
    nextOrderNumber(orgId: string): Promise<number>;
    createConditional(order: Order): Promise<boolean>;
    get(orgId: string, orderId: string): Promise<Order | null>;
    listByOrg(orgId: string, opts?: { limit?: number; exclusiveStartKey?: Record<string, any>; status?: OrderStatus; site?: OrderSiteScope }): Promise<{ items: Order[]; lastEvaluatedKey?: Record<string, any> }>;
    dailyTotals(orgId: string, fromIso: string, toIso: string, site?: OrderSiteScope): Promise<{ day: string; orders: number; revenueCents: number }[]>;
    updateStatus(orgId: string, orderId: string, expectedFrom: OrderStatus[], to: OrderStatus, set?: Record<string, any>): Promise<boolean>;
    claimReceiptSend(orgId: string, orderId: string): Promise<boolean>;
    /** Mirror seams (dual-write): full-row upsert + monotonic counter sync. */
    upsert(order: Order): Promise<void>;
    syncOrderCounter(orgId: string, seq: number): Promise<void>;
}

/** OrderDynamoRepo — the DynamoDB implementation (PK `orgId`, SK `orderId`). */
export class OrderDynamoRepo implements IOrderRepo {
    constructor(private ddb: IDdb) {}

    /**
     * Atomic per-org sequential order number. A gap can appear if a later step loses
     * a conditional create (webhook replay) — gaps are acceptable; collisions are not.
     */
    async nextOrderNumber(orgId: string): Promise<number> {
        const { Attributes } = await this.ddb.update(
            Tables.ORDERS,
            { orgId, orderId: ORDER_COUNTER_SK },
            {
                UpdateExpression: 'ADD seq :one',
                ExpressionAttributeValues: { ':one': 1 },
                ReturnValues: 'UPDATED_NEW',
            },
        );
        return (Attributes as any)?.seq ?? 1;
    }

    /** Conditional create (`attribute_not_exists(orderId)`) — false on webhook replay. */
    async createConditional(order: Order): Promise<boolean> {
        try {
            await this.ddb.transactWrite([
                {
                    Put: {
                        TableName: Tables.ORDERS,
                        Item: order,
                        ConditionExpression: 'attribute_not_exists(orderId)',
                    },
                },
            ]);
            return true;
        } catch (err: any) {
            if (isConditionalCancel(err)) return false;
            throw err;
        }
    }

    async get(orgId: string, orderId: string): Promise<Order | null> {
        const { Item } = await this.ddb.getItem(Tables.ORDERS, { orgId, orderId });
        return (Item as Order) ?? null;
    }

    /** Newest-first, cursor-paginated; optional status + per-website filters.
     *  Skips the COUNTER item. */
    async listByOrg(
        orgId: string,
        opts?: { limit?: number; exclusiveStartKey?: Record<string, any>; status?: OrderStatus; site?: OrderSiteScope },
    ): Promise<{ items: Order[]; lastEvaluatedKey?: Record<string, any> }> {
        const params: any = {
            TableName: Tables.ORDERS,
            IndexName: ORDER_ORG_CREATED_INDEX,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
            ScanIndexForward: false,
            Limit: opts?.limit ?? 20,
            ExclusiveStartKey: opts?.exclusiveStartKey,
        };
        const filters: string[] = [];
        if (opts?.status) {
            filters.push('#s = :st');
            params.ExpressionAttributeNames = { ...(params.ExpressionAttributeNames ?? {}), '#s': 'status' };
            params.ExpressionAttributeValues[':st'] = opts.status;
        }
        if (opts?.site) {
            filters.push(opts.site.includeUnattributed
                ? '(siteHost = :sh OR attribute_not_exists(siteHost))'
                : 'siteHost = :sh');
            params.ExpressionAttributeValues[':sh'] = opts.site.host;
        }
        if (filters.length) params.FilterExpression = filters.join(' AND ');
        const { Items, LastEvaluatedKey } = await this.ddb.query(params);
        return { items: (Items as Order[]) ?? [], lastEvaluatedKey: LastEvaluatedKey };
    }

    /**
     * Per-day order counts + revenue for a date range — the AUTHORITATIVE numbers
     * for the analytics dashboard (orders are written by the Stripe webhook with a
     * deterministic `ord-{sessionId}` id, so this is exact, unlike beacon events).
     * Bounded query on the OrgCreatedIndex GSI (`orgId` + `createdAt BETWEEN`),
     * revenue counts paid/fulfilled/shipped only (pending/cancelled/refunded excluded).
     */
    async dailyTotals(
        orgId: string,
        fromIso: string,
        toIso: string,
        site?: OrderSiteScope,
    ): Promise<{ day: string; orders: number; revenueCents: number }[]> {
        const byDay = new Map<string, { day: string; orders: number; revenueCents: number }>();
        let lastKey: Record<string, any> | undefined;
        do {
            const { Items, LastEvaluatedKey } = await this.ddb.query({
                TableName: Tables.ORDERS,
                IndexName: ORDER_ORG_CREATED_INDEX,
                KeyConditionExpression: 'orgId = :orgId AND createdAt BETWEEN :from AND :to',
                ExpressionAttributeValues: { ':orgId': orgId, ':from': fromIso, ':to': toIso },
                ExclusiveStartKey: lastKey,
            });
            for (const o of (Items as Order[]) ?? []) {
                if (!['paid', 'fulfilled', 'shipped'].includes(o.status)) continue;
                if (site && o.siteHost !== site.host && !(site.includeUnattributed && o.siteHost == null)) continue;
                const day = String(o.createdAt).slice(0, 10);
                const row = byDay.get(day) ?? { day, orders: 0, revenueCents: 0 };
                row.orders += 1;
                row.revenueCents += o.totalCents ?? 0;
                byDay.set(day, row);
            }
            lastKey = LastEvaluatedKey;
        } while (lastKey);
        return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
    }

    /**
     * Conditional status transition (`status IN (expectedFrom)`), optionally writing
     * extra top-level attributes (fulfilment, refund, linkedInvoiceId, paymentIntentId).
     * Returns false when the current status is outside `expectedFrom`.
     */
    async updateStatus(
        orgId: string,
        orderId: string,
        expectedFrom: OrderStatus[],
        to: OrderStatus,
        set?: Record<string, any>,
    ): Promise<boolean> {
        const names: Record<string, string> = { '#s': 'status' };
        const values: Record<string, any> = { ':to': to, ':now': new Date().toISOString() };
        const sets = ['#s = :to', 'updatedAt = :now'];
        const fromKeys = expectedFrom.map((f, i) => {
            values[`:f${i}`] = f;
            return `:f${i}`;
        });
        let n = 0;
        for (const [k, v] of Object.entries(set ?? {})) {
            const nk = `#k${n}`, vk = `:v${n}`;
            names[nk] = k;
            values[vk] = v;
            sets.push(`${nk} = ${vk}`);
            n++;
        }
        try {
            await this.ddb.update(
                Tables.ORDERS,
                { orgId, orderId },
                {
                    UpdateExpression: `SET ${sets.join(', ')}`,
                    ConditionExpression: `attribute_exists(orderId) AND #s IN (${fromKeys.join(', ')})`,
                    ExpressionAttributeNames: names,
                    ExpressionAttributeValues: values,
                },
            );
            return true;
        } catch (err: any) {
            if (isConditionalCancel(err)) return false;
            throw err;
        }
    }

    /**
     * Claim the buyer-receipt send (`attribute_not_exists(receiptSentAt)`). Returns true
     * exactly once; the caller sends the email only when it wins.
     */
    async claimReceiptSend(orgId: string, orderId: string): Promise<boolean> {
        try {
            await this.ddb.update(
                Tables.ORDERS,
                { orgId, orderId },
                {
                    UpdateExpression: 'SET receiptSentAt = :now',
                    ConditionExpression: 'attribute_exists(orderId) AND attribute_not_exists(receiptSentAt)',
                    ExpressionAttributeValues: { ':now': new Date().toISOString() },
                },
            );
            return true;
        } catch (err: any) {
            if (isConditionalCancel(err)) return false;
            throw err;
        }
    }

    /** Mirror seam — plain put of the authoritative row (used by dual-write only). */
    async upsert(order: Order): Promise<void> {
        await this.ddb.put(Tables.ORDERS, order as unknown as Record<string, any>);
    }

    /** Mirror seam — raise the COUNTER to at least `seq` (never lowers; loss-free on races). */
    async syncOrderCounter(orgId: string, seq: number): Promise<void> {
        try {
            await this.ddb.update(
                Tables.ORDERS,
                { orgId, orderId: ORDER_COUNTER_SK },
                {
                    UpdateExpression: 'SET seq = :v',
                    ConditionExpression: 'attribute_not_exists(seq) OR seq < :v',
                    ExpressionAttributeValues: { ':v': seq },
                },
            );
        } catch (err: any) {
            if (!isConditionalCancel(err)) throw err; // already >= seq — fine
        }
    }
}
