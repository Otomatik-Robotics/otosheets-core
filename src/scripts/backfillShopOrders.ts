/**
 * Shop-orders backfill: DynamoDB (`expense-app-orders-{env}`) → Postgres
 * `shop_orders` + `shop_order_counters` (commerce domain cutover). Idempotent:
 * rows upsert last-writer-wins on updated_at; counters only ever rise. COUNTER
 * items become shop_order_counters rows; order rows are validated against
 * OrderSchema and reported (not written) when they fail.
 *
 * Usage:
 *   export AWS_PROFILE=sandbox AWS_REGION=ap-southeast-2
 *   export ORDERS_TABLE=expense-app-orders-dev DATABASE_URL=...   (DATABASE_URL not needed for --report)
 *   node dist/scripts/backfillShopOrders.js [--report]
 *
 * After a WRITE run it verifies per-org counts + revenue sums (pg == dynamo).
 */
import { ddb } from '../ddbClient';
import { Tables } from '../tables';
import { getPg } from '../pg/client';
import { shopOrders } from '../pg/schema/commerce';
import { OrderSchema, ORDER_COUNTER_SK, type Order } from '../order/schema';
import { OrderPgRepo } from '../order/repo.pg';
import { eq, sql } from 'drizzle-orm';

async function* scan(): AsyncGenerator<Record<string, any>> {
    let k: any;
    do {
        const p = await ddb.scan({ TableName: Tables.ORDERS, ExclusiveStartKey: k });
        for (const i of p.Items ?? []) yield i;
        k = p.LastEvaluatedKey;
    } while (k);
}

export async function backfillShopOrders(reportOnly: boolean): Promise<void> {
    const pg = new OrderPgRepo();
    const dynamoTotals = new Map<string, { orders: number; revenueCents: number }>();
    let orders = 0, counters = 0, invalid = 0;
    console.log(`shop-orders backfill (${reportOnly ? 'REPORT-ONLY' : 'WRITE'})`);

    for await (const item of scan()) {
        if (item.orderId === ORDER_COUNTER_SK) {
            if (!reportOnly) await pg.syncOrderCounter(item.orgId, Number(item.seq ?? 0));
            counters++;
            continue;
        }
        const parsed = OrderSchema.safeParse(item);
        if (!parsed.success) {
            invalid++;
            console.warn(`  invalid order skipped: ${item.orgId}/${item.orderId} — ${parsed.error.issues[0]?.path?.join('.')}: ${parsed.error.issues[0]?.message}`);
            continue;
        }
        const o = parsed.data as Order;
        if (['paid', 'fulfilled', 'shipped'].includes(o.status)) {
            const t = dynamoTotals.get(o.orgId) ?? { orders: 0, revenueCents: 0 };
            t.orders += 1; t.revenueCents += o.totalCents;
            dynamoTotals.set(o.orgId, t);
        }
        if (!reportOnly) await pg.upsert(o);
        orders++;
    }
    console.log(`orders=${orders} counters=${counters} invalid=${invalid}`);

    if (!reportOnly && dynamoTotals.size > 0) {
        const db = getPg();
        let mismatches = 0;
        for (const [orgId, dyn] of dynamoTotals) {
            const r = await db.select({
                orders: sql<number>`count(*)`,
                revenueCents: sql<number>`coalesce(sum(${shopOrders.totalCents}), 0)`,
            }).from(shopOrders).where(sql`${shopOrders.orgId} = ${orgId} AND ${shopOrders.status} IN ('paid','fulfilled','shipped')`);
            const pgOrders = Number(r[0]?.orders ?? 0), pgRev = Number(r[0]?.revenueCents ?? 0);
            const ok = pgOrders === dyn.orders && pgRev === dyn.revenueCents;
            if (!ok) { mismatches++; console.warn(`MISMATCH ${orgId}: dynamo=${dyn.orders}/${dyn.revenueCents}c pg=${pgOrders}/${pgRev}c`); }
            else console.log(`  ${orgId}: ${pgOrders} paid orders, ${pgRev}c revenue ✓`);
        }
        console.log(mismatches === 0 ? '✓ shop-orders reconciliation clean' : `✗ ${mismatches} mismatch(es)`);
        if (mismatches > 0) process.exitCode = 2;
    }
    void eq; // keep the import stable if the verification block changes shape
}

if (require.main === module) {
    backfillShopOrders(process.argv.includes('--report')).catch((e) => {
        console.error('shop-orders backfill failed:', e);
        process.exit(1);
    });
}
