import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { Product } from './schema';

/**
 * True when a failed write was cancelled by a ConditionExpression (duplicate create
 * or insufficient stock) rather than a real error.
 */
function isConditionalCancel(err: any): boolean {
    if (err?.name === 'ConditionalCheckFailedException') return true;
    if (err?.name !== 'TransactionCanceledException') return false;
    const reasons: any[] = err?.CancellationReasons ?? [];
    return reasons.some((r) => r?.Code === 'ConditionalCheckFailed');
}

/** ProductRepo — DynamoDB-only (PK `orgId`, SK `productId`). */
export class ProductRepo {
    constructor(private ddb: IDdb) {}

    /** Conditional create (`attribute_not_exists(productId)`) — false on duplicate id. */
    async create(product: Product): Promise<boolean> {
        try {
            await this.ddb.transactWrite([
                {
                    Put: {
                        TableName: Tables.PRODUCTS,
                        Item: product,
                        ConditionExpression: 'attribute_not_exists(productId)',
                    },
                },
            ]);
            return true;
        } catch (err: any) {
            if (isConditionalCancel(err)) return false;
            throw err;
        }
    }

    /** Unconditional upsert (edits). */
    async put(product: Product): Promise<void> {
        await this.ddb.put(Tables.PRODUCTS, product);
    }

    async get(orgId: string, productId: string): Promise<Product | null> {
        const { Item } = await this.ddb.getItem(Tables.PRODUCTS, { orgId, productId });
        return (Item as Product) ?? null;
    }

    /** All products for an org (owner catalogue view). */
    async listByOrg(orgId: string): Promise<Product[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.PRODUCTS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return ((Items as Product[]) ?? []).filter((p) => p.status !== undefined);
    }

    /** Active products only — the storefront render read (hot path, gated by config). */
    async listActiveByOrg(orgId: string): Promise<Product[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.PRODUCTS,
            KeyConditionExpression: 'orgId = :orgId',
            FilterExpression: '#s = :active',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':orgId': orgId, ':active': 'active' },
        });
        return (Items as Product[]) ?? [];
    }

    async findBySlug(orgId: string, slug: string): Promise<Product | null> {
        const { Items } = await this.ddb.query({
            TableName: Tables.PRODUCTS,
            KeyConditionExpression: 'orgId = :orgId',
            FilterExpression: 'slug = :slug',
            ExpressionAttributeValues: { ':orgId': orgId, ':slug': slug },
            Limit: 1,
        });
        return ((Items as Product[]) ?? [])[0] ?? null;
    }

    async archive(orgId: string, productId: string): Promise<void> {
        await this.ddb.update(
            Tables.PRODUCTS,
            { orgId, productId },
            {
                UpdateExpression: 'SET #s = :archived, updatedAt = :now',
                ConditionExpression: 'attribute_exists(productId)',
                ExpressionAttributeNames: { '#s': 'status' },
                ExpressionAttributeValues: { ':archived': 'archived', ':now': new Date().toISOString() },
            },
        );
    }

    /**
     * Conditionally decrement a tracked variant's stock (no oversell). Returns:
     *  - true  when the decrement succeeded, OR the variant is untracked (stock == null)
     *  - false when there was insufficient stock, or the product/variant is gone
     * Guards on both `variantId` (survives array reordering) and `stock >= qty`.
     */
    async decrementVariantStock(
        orgId: string,
        productId: string,
        variantId: string,
        qty: number,
    ): Promise<boolean> {
        const product = await this.get(orgId, productId);
        if (!product) return false;
        const i = product.variants.findIndex((v) => v.variantId === variantId);
        if (i < 0) return false;
        if (product.variants[i].stock === null || product.variants[i].stock === undefined) return true;
        try {
            await this.ddb.update(
                Tables.PRODUCTS,
                { orgId, productId },
                {
                    UpdateExpression: `SET variants[${i}].stock = variants[${i}].stock - :q, updatedAt = :now`,
                    ConditionExpression: `variants[${i}].variantId = :vid AND variants[${i}].stock >= :q`,
                    ExpressionAttributeValues: { ':q': qty, ':vid': variantId, ':now': new Date().toISOString() },
                },
            );
            return true;
        } catch (err: any) {
            if (isConditionalCancel(err)) return false;
            throw err;
        }
    }

    /** Restore stock on a refund/cancel (unconditional add; only for tracked variants). */
    async incrementVariantStock(
        orgId: string,
        productId: string,
        variantId: string,
        qty: number,
    ): Promise<void> {
        const product = await this.get(orgId, productId);
        if (!product) return;
        const i = product.variants.findIndex((v) => v.variantId === variantId);
        if (i < 0 || product.variants[i].stock === null || product.variants[i].stock === undefined) return;
        await this.ddb.update(
            Tables.PRODUCTS,
            { orgId, productId },
            {
                UpdateExpression: `SET variants[${i}].stock = variants[${i}].stock + :q, updatedAt = :now`,
                ConditionExpression: `variants[${i}].variantId = :vid`,
                ExpressionAttributeValues: { ':q': qty, ':vid': variantId, ':now': new Date().toISOString() },
            },
        );
    }
}
