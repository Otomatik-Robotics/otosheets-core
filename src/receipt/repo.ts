import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { sk, dateSk } from '../keys';
import { Receipt } from './schema';

export class ReceiptRepo {
    constructor(private ddb: IDdb) {}

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
