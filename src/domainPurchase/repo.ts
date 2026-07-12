/**
 * DomainPurchaseRepo — DynamoDB-only repo for the DomainPurchase state machine
 * (table `expense-app-domain-purchases-{env}`, PK `orgId`, SK `purchaseId`).
 *
 * Idempotency (hard requirement — this is the data layer):
 *   - `create` is conditional (`attribute_not_exists(purchaseId)`); the
 *     deterministic `dp-` id means a client retry lands on the same record and
 *     the create returns `false` instead of a second row.
 *   - every status flip is a conditional transition (`from`-state guarded).
 *   - `claim*` methods are conditional single-flight/sent markers.
 *
 * The sparse `PendingOperationsIndex` (`pendingKey='PENDING'` / `purchaseId`)
 * carries only purchases the watcher still owes work for (registering /
 * registered) — the sweep queries the index, never scans the table.
 *
 * The method surface matches the backend's `IDomainPurchaseStore` port so
 * `new DomainPurchaseRepo(ddb)` drops straight into the hexagonal service
 * wiring as the production adapter.
 */
import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import {
    DOMAIN_PURCHASE_PENDING_KEY,
    DomainPurchase,
    DomainPurchaseStatus,
    PENDING_OPERATIONS_INDEX,
    PENDING_STATUSES,
} from './schema';

/**
 * True when a failed `transactWrite` was cancelled by a ConditionExpression —
 * i.e. the record already existed, so the conditional create is a duplicate we
 * report as "lost the write" rather than an error.
 */
function isConditionalCancel(err: any): boolean {
    if (err?.name === 'ConditionalCheckFailedException') return true;
    if (err?.name !== 'TransactionCanceledException') return false;
    const reasons: any[] = err?.CancellationReasons ?? [];
    return reasons.some((r) => r?.Code === 'ConditionalCheckFailed');
}

export class DomainPurchaseRepo {
    constructor(private ddb: IDdb) {}

    /**
     * Conditional create (`attribute_not_exists(purchaseId)`) — returns false
     * when the purchaseId already exists (deterministic id ⇒ a replay lands here).
     */
    async create(purchase: DomainPurchase): Promise<boolean> {
        const item: DomainPurchase = {
            ...purchase,
            // Sparse-GSI membership derives from status.
            ...(PENDING_STATUSES.includes(purchase.status)
                ? { pendingKey: DOMAIN_PURCHASE_PENDING_KEY }
                : {}),
        };
        try {
            await this.ddb.transactWrite([
                {
                    Put: {
                        TableName: Tables.DOMAIN_PURCHASES,
                        Item: item,
                        ConditionExpression: 'attribute_not_exists(purchaseId)',
                    },
                },
            ]);
            return true;
        } catch (err: any) {
            if (isConditionalCancel(err)) return false;
            throw err;
        }
    }

    async get(orgId: string, purchaseId: string): Promise<DomainPurchase | null> {
        const { Item } = await this.ddb.getItem(Tables.DOMAIN_PURCHASES, { orgId, purchaseId });
        return (Item as DomainPurchase) ?? null;
    }

    async listByOrg(
        orgId: string,
        limit: number,
        exclusiveStartKey?: Record<string, any>,
    ): Promise<{ items: DomainPurchase[]; lastEvaluatedKey?: Record<string, any> }> {
        const { Items, LastEvaluatedKey } = await this.ddb.query({
            TableName: Tables.DOMAIN_PURCHASES,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
            Limit: limit,
            ExclusiveStartKey: exclusiveStartKey,
        });
        return { items: (Items as DomainPurchase[]) ?? [], lastEvaluatedKey: LastEvaluatedKey };
    }

    /** Watcher sweep surface — paginates the sparse index fully (bounded: only in-flight purchases). */
    async listPending(): Promise<DomainPurchase[]> {
        const items: DomainPurchase[] = [];
        let exclusiveStartKey: Record<string, any> | undefined;
        do {
            const { Items, LastEvaluatedKey } = await this.ddb.query({
                TableName: Tables.DOMAIN_PURCHASES,
                IndexName: PENDING_OPERATIONS_INDEX,
                KeyConditionExpression: 'pendingKey = :p',
                ExpressionAttributeValues: { ':p': DOMAIN_PURCHASE_PENDING_KEY },
                ExclusiveStartKey: exclusiveStartKey,
            });
            items.push(...((Items as DomainPurchase[]) ?? []));
            exclusiveStartKey = LastEvaluatedKey;
        } while (exclusiveStartKey);
        return items;
    }

    /**
     * Single-flight claim around the non-idempotent RegisterDomain call. Wins
     * when status is pending_payment, no operationId exists yet, and no claim is
     * held (or the held claim is older than `staleBefore` — a crashed attempt
     * whose register call demonstrably never completed its bookkeeping).
     */
    async claimRegisterAttempt(orgId: string, purchaseId: string, now: string, staleBefore: string): Promise<boolean> {
        try {
            await this.ddb.update(Tables.DOMAIN_PURCHASES, { orgId, purchaseId }, {
                UpdateExpression: 'SET registerClaimedAt = :now, updatedAt = :now',
                ConditionExpression: '#status = :pending AND attribute_not_exists(operationId) '
                    + 'AND (attribute_not_exists(registerClaimedAt) OR registerClaimedAt < :stale)',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':now': now, ':pending': 'pending_payment', ':stale': staleBefore },
            });
            return true;
        } catch (err: any) {
            if (err?.name === 'ConditionalCheckFailedException') return false;
            throw err;
        }
    }

    /**
     * Conditional status transition `from` → `to`, applying `updates` in the
     * same write. Returns false when the record is no longer in a `from` state
     * (someone else already moved it). Manages the sparse pendingKey attribute.
     */
    async transition(
        orgId: string,
        purchaseId: string,
        from: DomainPurchaseStatus[],
        to: DomainPurchaseStatus,
        updates: Partial<DomainPurchase> = {},
    ): Promise<boolean> {
        const names: Record<string, string> = { '#status': 'status' };
        const values: Record<string, any> = { ':to': to, ':now': new Date().toISOString() };
        const sets: string[] = ['#status = :to', 'updatedAt = :now'];
        const removes: string[] = [];

        for (const [k, v] of Object.entries(updates)) {
            if (v === undefined || k === 'status' || k === 'orgId' || k === 'purchaseId') continue;
            names[`#u_${k}`] = k;
            values[`:u_${k}`] = v;
            sets.push(`#u_${k} = :u_${k}`);
        }

        // Sparse-GSI maintenance: in-flight statuses carry pendingKey.
        names['#pendingKey'] = 'pendingKey';
        if (PENDING_STATUSES.includes(to)) {
            values[':pending'] = DOMAIN_PURCHASE_PENDING_KEY;
            sets.push('#pendingKey = :pending');
        } else {
            removes.push('#pendingKey');
        }

        const fromConditions = from.map((s, i) => {
            values[`:from${i}`] = s;
            return `#status = :from${i}`;
        });

        try {
            await this.ddb.update(Tables.DOMAIN_PURCHASES, { orgId, purchaseId }, {
                UpdateExpression: `SET ${sets.join(', ')}${removes.length ? ` REMOVE ${removes.join(', ')}` : ''}`,
                ConditionExpression: `attribute_exists(purchaseId) AND (${fromConditions.join(' OR ')})`,
                ExpressionAttributeNames: names,
                ExpressionAttributeValues: values,
            });
            return true;
        } catch (err: any) {
            if (err?.name === 'ConditionalCheckFailedException') return false;
            throw err;
        }
    }

    /** Idempotent: stores the PaymentIntent id only if none is stored yet. */
    async setPaymentIntent(orgId: string, purchaseId: string, paymentIntentId: string): Promise<void> {
        try {
            await this.ddb.update(Tables.DOMAIN_PURCHASES, { orgId, purchaseId }, {
                UpdateExpression: 'SET stripePaymentIntentId = :pi, updatedAt = :now',
                // A replay writes the same value (idempotent Stripe key) —
                // losing the condition is fine, never an error.
                ConditionExpression: 'attribute_exists(purchaseId) AND attribute_not_exists(stripePaymentIntentId)',
                ExpressionAttributeValues: { ':pi': paymentIntentId, ':now': new Date().toISOString() },
            });
        } catch (err: any) {
            if (err?.name === 'ConditionalCheckFailedException') return;
            throw err;
        }
    }

    /** Conditional sent-marker — claimed BEFORE the auth-code email is sent. */
    async claimAuthCodeEmail(orgId: string, purchaseId: string): Promise<boolean> {
        try {
            await this.ddb.update(Tables.DOMAIN_PURCHASES, { orgId, purchaseId }, {
                UpdateExpression: 'SET authCodeEmailSentAt = :now, updatedAt = :now',
                ConditionExpression: 'attribute_exists(purchaseId) AND attribute_not_exists(authCodeEmailSentAt)',
                ExpressionAttributeValues: { ':now': new Date().toISOString() },
            });
            return true;
        } catch (err: any) {
            if (err?.name === 'ConditionalCheckFailedException') return false;
            throw err;
        }
    }

    /** Best-effort diagnostics (unconditional beyond record existence). */
    async recordError(orgId: string, purchaseId: string, message: string): Promise<void> {
        try {
            await this.ddb.update(Tables.DOMAIN_PURCHASES, { orgId, purchaseId }, {
                UpdateExpression: 'SET lastError = :err, updatedAt = :now',
                ConditionExpression: 'attribute_exists(purchaseId)',
                ExpressionAttributeValues: { ':err': message.slice(0, 1000), ':now': new Date().toISOString() },
            });
        } catch (err) {
            console.warn('[DomainPurchaseRepo] recordError failed (diagnostics only):', err);
        }
    }
}
