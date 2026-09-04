import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { sk, dateSk } from '../keys';
import { Receipt } from './schema';

/** Store-agnostic contract — ReceiptDynamoRepo + ReceiptPgRepo; ReceiptRepo (factory) routes. */
export interface IReceiptRepo {
    getReceipt(orgId: string, userId: string, receiptId: string): Promise<Receipt | null>;
    findReceiptByIdInOrg(orgId: string, receiptId: string): Promise<{ receipt: Receipt; ownerId: string } | null>;
    findReceiptByDescriptionPrefix(orgId: string, prefix: string): Promise<Receipt | null>;
    findReceiptByContentHash(orgId: string, contentHash: string): Promise<Receipt | null>;
    findReceiptsByDuplicateOf(orgId: string, receiptId: string): Promise<Receipt[]>;
    findReceiptsByVendorAndAmount(orgId: string, vendorName: string, amount: number): Promise<Receipt[]>;
    listAllOrgReceipts(orgId: string): Promise<Receipt[]>;
    listUserReceipts(orgId: string, userId: string): Promise<Receipt[]>;
    listReceiptsByDate(orgId: string, from: string, to: string, projection?: string): Promise<Receipt[]>;
    createReceipt(orgId: string, userId: string, receiptId: string, data: Record<string, any>): Promise<void>;
    updateReceipt(orgId: string, userId: string, receiptId: string, updates: Record<string, any>): Promise<void>;
    deleteReceipt(orgId: string, userId: string, receiptId: string): Promise<void>;
    upsertReceipt(receipt: Receipt): Promise<void>;

    // ── Review + asset signals (0046) — each returns true only when THIS call changed the row ──
    /** Record the first open by `userId`. Sets openedAt/openedBy only when unset; a re-open is a no-op (false). */
    markOpened(orgId: string, receiptId: string, userId: string): Promise<boolean>;
    /** Set the category as human-confirmed (also acknowledges the AI risk flag if not already). False when the receipt doesn't exist. */
    confirmCategory(orgId: string, receiptId: string, opts: { category: string; userId: string }): Promise<boolean>;
    /** Link the asset this receipt became. Conditional on no OTHER asset being linked; a replay with the same asset is true. */
    linkAsset(orgId: string, receiptId: string, assetId: string): Promise<boolean>;
    /** Decline the "looks like an asset" offer. False when already declined, already promoted, or missing. */
    declineAssetOffer(orgId: string, receiptId: string): Promise<boolean>;
}

const isConditionalFailure = (err: any): boolean =>
    err?.name === 'ConditionalCheckFailedException' || err?.code === 'ConditionalCheckFailedException';

export class ReceiptDynamoRepo implements IReceiptRepo {
    constructor(private ddb: IDdb) {}

    /** Receipts are keyed (orgId, ownerId#receiptId); by-id operations resolve the owner through ReceiptIdIndex. */
    private async keyOf(orgId: string, receiptId: string): Promise<{ orgId: string; sk: string } | null> {
        const found = await this.findReceiptByIdInOrg(orgId, receiptId);
        return found ? { orgId, sk: sk(found.ownerId, receiptId) } : null;
    }

    /** A conditional update that reports "condition lost" as false instead of throwing. */
    private async conditionalUpdate(key: { orgId: string; sk: string }, params: Record<string, any>): Promise<boolean> {
        try {
            await this.ddb.update(Tables.RECEIPTS, key, params);
            return true;
        } catch (err: any) {
            if (isConditionalFailure(err)) return false;
            throw err;
        }
    }

    async markOpened(orgId: string, receiptId: string, userId: string): Promise<boolean> {
        const key = await this.keyOf(orgId, receiptId);
        if (!key) return false;
        return this.conditionalUpdate(key, {
            UpdateExpression: 'SET #openedAt = :now, #openedBy = :user',
            ConditionExpression: 'attribute_exists(sk) AND attribute_not_exists(#openedAt)',
            ExpressionAttributeNames: { '#openedAt': 'openedAt', '#openedBy': 'openedBy' },
            ExpressionAttributeValues: { ':now': new Date().toISOString(), ':user': userId },
        });
    }

    async confirmCategory(orgId: string, receiptId: string, opts: { category: string; userId: string }): Promise<boolean> {
        const key = await this.keyOf(orgId, receiptId);
        if (!key) return false;
        return this.conditionalUpdate(key, {
            UpdateExpression: 'SET #category = :category, #confirmedAt = :now, #confirmedBy = :user, '
                + '#reviewedAt = if_not_exists(#reviewedAt, :now), #reviewedBy = if_not_exists(#reviewedBy, :user)',
            ConditionExpression: 'attribute_exists(sk)',
            ExpressionAttributeNames: {
                '#category': 'category', '#confirmedAt': 'categoryConfirmedAt', '#confirmedBy': 'categoryConfirmedBy',
                '#reviewedAt': 'reviewedAt', '#reviewedBy': 'reviewedBy',
            },
            ExpressionAttributeValues: { ':category': opts.category, ':now': new Date().toISOString(), ':user': opts.userId },
        });
    }

    async linkAsset(orgId: string, receiptId: string, assetId: string): Promise<boolean> {
        const key = await this.keyOf(orgId, receiptId);
        if (!key) return false;
        return this.conditionalUpdate(key, {
            UpdateExpression: 'SET #assetId = :assetId',
            ConditionExpression: 'attribute_exists(sk) AND (attribute_not_exists(#assetId) OR #assetId = :assetId)',
            ExpressionAttributeNames: { '#assetId': 'assetId' },
            ExpressionAttributeValues: { ':assetId': assetId },
        });
    }

    async declineAssetOffer(orgId: string, receiptId: string): Promise<boolean> {
        const key = await this.keyOf(orgId, receiptId);
        if (!key) return false;
        return this.conditionalUpdate(key, {
            UpdateExpression: 'SET #declinedAt = :now',
            ConditionExpression: 'attribute_exists(sk) AND attribute_not_exists(#declinedAt) AND attribute_not_exists(#assetId)',
            ExpressionAttributeNames: { '#declinedAt': 'assetDeclinedAt', '#assetId': 'assetId' },
            ExpressionAttributeValues: { ':now': new Date().toISOString() },
        });
    }

    async upsertReceipt(receipt: Receipt): Promise<void> {
        await this.ddb.put(Tables.RECEIPTS, receipt);
    }

    async getReceipt(orgId: string, userId: string, receiptId: string): Promise<Receipt | null> {
        const { Item } = await this.ddb.getItem(Tables.RECEIPTS, { orgId, sk: sk(userId, receiptId) });
        return (Item as Receipt) ?? null;
    }

    async findReceiptByIdInOrg(orgId: string, receiptId: string): Promise<{ receipt: Receipt; ownerId: string } | null> {
        const { Items } = await this.ddb.query({
            TableName: Tables.RECEIPTS,
            IndexName: 'ReceiptIdIndex',
            KeyConditionExpression: 'orgId = :orgId AND receiptId = :receiptId',
            ExpressionAttributeValues: { ':orgId': orgId, ':receiptId': receiptId },
            Limit: 1,
        });
        const item = Items?.[0] as Receipt | undefined;
        if (!item) return null;
        return { receipt: item, ownerId: item.createdBy };
    }

    async findReceiptByDescriptionPrefix(orgId: string, prefix: string): Promise<Receipt | null> {
        const { Items } = await this.ddb.query({
            TableName: Tables.RECEIPTS,
            IndexName: 'CreatedAtIndex',
            KeyConditionExpression: 'orgId = :orgId',
            FilterExpression: 'begins_with(#description, :prefix)',
            ExpressionAttributeNames: { '#description': 'description' },
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': prefix },
            Limit: 1,
        });
        return (Items?.[0] as Receipt) ?? null;
    }

    async findReceiptByContentHash(orgId: string, contentHash: string): Promise<Receipt | null> {
        const { Items } = await this.ddb.query({
            TableName: Tables.RECEIPTS,
            IndexName: 'CreatedAtIndex',
            KeyConditionExpression: 'orgId = :orgId',
            FilterExpression: '#contentHash = :contentHash AND #status <> :archived AND #status <> :duplicate',
            ExpressionAttributeNames: { '#contentHash': 'contentHash', '#status': 'status' },
            ExpressionAttributeValues: {
                ':orgId': orgId,
                ':contentHash': contentHash,
                ':archived': 'ARCHIVED',
                ':duplicate': 'DUPLICATE',
            },
            Limit: 1,
        });
        return (Items?.[0] as Receipt) ?? null;
    }

    async findReceiptsByDuplicateOf(orgId: string, receiptId: string): Promise<Receipt[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.RECEIPTS,
            IndexName: 'CreatedAtIndex',
            KeyConditionExpression: 'orgId = :orgId',
            FilterExpression: '#status = :duplicate AND #duplicateOf = :receiptId',
            ExpressionAttributeNames: { '#status': 'status', '#duplicateOf': 'duplicateOf' },
            ExpressionAttributeValues: {
                ':orgId': orgId,
                ':duplicate': 'DUPLICATE',
                ':receiptId': receiptId,
            },
        });
        return (Items as Receipt[]) ?? [];
    }

    async findReceiptsByVendorAndAmount(orgId: string, vendorName: string, amount: number): Promise<Receipt[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.RECEIPTS,
            IndexName: 'CreatedAtIndex',
            KeyConditionExpression: 'orgId = :orgId',
            FilterExpression: '#vendorName = :vendorName AND #totalAmount BETWEEN :lo AND :hi AND #status <> :archived AND #status <> :duplicate',
            ExpressionAttributeNames: { '#vendorName': 'vendorName', '#totalAmount': 'totalAmount', '#status': 'status' },
            ExpressionAttributeValues: {
                ':orgId': orgId,
                ':vendorName': vendorName,
                ':lo': amount - 0.01,
                ':hi': amount + 0.01,
                ':archived': 'ARCHIVED',
                ':duplicate': 'DUPLICATE',
            },
        });
        return (Items as Receipt[]) ?? [];
    }

    async listAllOrgReceipts(orgId: string): Promise<Receipt[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.RECEIPTS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return (Items as Receipt[]) ?? [];
    }

    async listUserReceipts(orgId: string, userId: string): Promise<Receipt[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.RECEIPTS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `${userId}#` },
        });
        return (Items as Receipt[]) ?? [];
    }

    async listReceiptsByDate(orgId: string, from: string, to: string, projection?: string): Promise<Receipt[]> {
        const params: any = {
            TableName: Tables.RECEIPTS,
            IndexName: 'DateIndex',
            KeyConditionExpression: 'orgId = :orgId AND dateSk BETWEEN :from AND :to',
            ExpressionAttributeValues: { ':orgId': orgId, ':from': from, ':to': `${to}￿` },
        };
        if (projection) {
            params.ProjectionExpression = projection;
        }
        const { Items } = await this.ddb.query(params);
        return (Items as Receipt[]) ?? [];
    }

    async createReceipt(orgId: string, userId: string, receiptId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.RECEIPTS, {
            orgId,
            sk: sk(userId, receiptId),
            receiptId,
            createdBy: userId,
            ...data,
            dateSk: data.date ? dateSk(data.date, receiptId) : undefined,
            createdAt: now,
        });
    }

    async updateReceipt(orgId: string, userId: string, receiptId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = [];
        const names: Record<string, string> = {};
        const values: Record<string, any> = {};

        if (updates.date) {
            updates.dateSk = dateSk(updates.date, receiptId);
        }

        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }

        await this.ddb.update(Tables.RECEIPTS, { orgId, sk: sk(userId, receiptId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }

    async deleteReceipt(orgId: string, userId: string, receiptId: string): Promise<void> {
        await this.ddb.delete(Tables.RECEIPTS, { orgId, sk: sk(userId, receiptId) });
    }
}
