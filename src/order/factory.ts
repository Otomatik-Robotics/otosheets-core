import { resolveRoute, type Route } from '../dataBackend';
import { mirrorWrite, shadowRead } from '../dualWrite';
import type { IDdb } from '../ddbPort';
import { Order, OrderStatus } from './schema';
import { OrderDynamoRepo, type IOrderRepo } from './repo';
import { OrderPgRepo } from './repo.pg';

const DOMAIN = 'commerce' as const;
const ENTITY = 'order';

/**
 * RoutingOrderRepo — dispatches to Postgres or DynamoDB per the `commerce`
 * data-backend flag (`/otosheets/{env}/data-backend/commerce`), mirroring writes
 * to the other store. Flag absent → 'dynamo' (ship-dark safe). Same pattern as
 * every routed domain; handlers keep constructing `new OrderRepo(ddb)`.
 */
export class RoutingOrderRepo implements IOrderRepo {
    constructor(private dynamo: IOrderRepo, private pg: IOrderRepo) {}
    private pick(r: Route): IOrderRepo { return r.primary === 'dynamo' ? this.dynamo : this.pg; }
    private mirrorOf(r: Route): IOrderRepo | undefined { return !r.mirror ? undefined : (r.mirror === 'dynamo' ? this.dynamo : this.pg); }

    /** Refresh the mirror's copy of one order from the primary (idempotent LWW upsert). */
    private async mirrorEntity(r: Route, orgId: string, orderId: string, op: string): Promise<void> {
        const m = this.mirrorOf(r); if (!m) return;
        await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op, key: { orgId, orderId } }, async () => {
            const fresh = await this.pick(r).get(orgId, orderId);
            if (fresh) await m.upsert(fresh);
        });
    }

    private async read<T>(op: string, primary: () => Promise<T>, shadow: () => Promise<T>, r: Route): Promise<T> {
        const res = await primary();
        if (r.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op }, res, shadow);
        return res;
    }

    async nextOrderNumber(orgId: string): Promise<number> {
        const r = await resolveRoute(DOMAIN);
        const seq = await this.pick(r).nextOrderNumber(orgId);
        const m = this.mirrorOf(r);
        // Monotonic counter sync — the mirror only ever rises, so a flag flip
        // never hands out a duplicate order number.
        if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'syncOrderCounter', key: { orgId } }, () => m.syncOrderCounter(orgId, seq));
        return seq;
    }

    async createConditional(order: Order): Promise<boolean> {
        const r = await resolveRoute(DOMAIN);
        const created = await this.pick(r).createConditional(order);
        if (created) await this.mirrorEntity(r, order.orgId, order.orderId, 'createConditional');
        return created;
    }

    async get(orgId: string, orderId: string): Promise<Order | null> {
        const r = await resolveRoute(DOMAIN);
        return this.read('get', () => this.pick(r).get(orgId, orderId), () => this.pg.get(orgId, orderId), r);
    }

    async listByOrg(orgId: string, opts?: { limit?: number; exclusiveStartKey?: Record<string, any>; status?: OrderStatus }) {
        // Cursor shapes differ between stores — no shadow compare on pagination.
        return this.pick(await resolveRoute(DOMAIN)).listByOrg(orgId, opts);
    }

    async dailyTotals(orgId: string, fromIso: string, toIso: string) {
        const r = await resolveRoute(DOMAIN);
        return this.read('dailyTotals', () => this.pick(r).dailyTotals(orgId, fromIso, toIso), () => this.pg.dailyTotals(orgId, fromIso, toIso), r);
    }

    async updateStatus(orgId: string, orderId: string, expectedFrom: OrderStatus[], to: OrderStatus, set?: Record<string, any>): Promise<boolean> {
        const r = await resolveRoute(DOMAIN);
        const ok = await this.pick(r).updateStatus(orgId, orderId, expectedFrom, to, set);
        if (ok) await this.mirrorEntity(r, orgId, orderId, 'updateStatus');
        return ok;
    }

    async claimReceiptSend(orgId: string, orderId: string): Promise<boolean> {
        const r = await resolveRoute(DOMAIN);
        const ok = await this.pick(r).claimReceiptSend(orgId, orderId);
        if (ok) await this.mirrorEntity(r, orgId, orderId, 'claimReceiptSend');
        return ok;
    }

    async upsert(order: Order): Promise<void> {
        const r = await resolveRoute(DOMAIN);
        await this.pick(r).upsert(order);
        const m = this.mirrorOf(r);
        if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'upsert', key: { orgId: order.orgId, orderId: order.orderId } }, () => m.upsert(order));
    }

    async syncOrderCounter(orgId: string, seq: number): Promise<void> {
        const r = await resolveRoute(DOMAIN);
        await this.pick(r).syncOrderCounter(orgId, seq);
        const m = this.mirrorOf(r);
        if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'syncOrderCounter', key: { orgId } }, () => m.syncOrderCounter(orgId, seq));
    }
}

/** The public OrderRepo — the routing wrapper (what handlers construct). */
export class OrderRepo extends RoutingOrderRepo {
    constructor(dynamoDb: IDdb) { super(new OrderDynamoRepo(dynamoDb), new OrderPgRepo()); }
}
