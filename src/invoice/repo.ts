import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { sk, dueDateSk } from '../keys';
import { Invoice } from './schema';

export interface PaginatedResult<T> {
    items: T[];
    lastEvaluatedKey?: Record<string, any>;
}

export interface ListInvoicesPaginatedParams {
    orgId: string;
    limit?: number;
    exclusiveStartKey?: Record<string, any>;
    status?: string;
    isQuote?: boolean;
}

export class InvoiceRepo {
    constructor(private ddb: IDdb) {}

    async getInvoice(orgId: string, userId: string, invoiceId: string): Promise<Invoice | null> {
        const { Item } = await this.ddb.getItem(Tables.INVOICES, { orgId, sk: sk(userId, invoiceId) });
        return (Item as Invoice) ?? null;
    }

    async findInvoiceByIdInOrg(orgId: string, invoiceId: string): Promise<{ invoice: Invoice; ownerId: string } | null> {
        const { Items } = await this.ddb.query({
            TableName: Tables.INVOICES,
            IndexName: 'InvoiceIdIndex',
            KeyConditionExpression: 'orgId = :orgId AND invoiceId = :invoiceId',
            ExpressionAttributeValues: { ':orgId': orgId, ':invoiceId': invoiceId },
            Limit: 1,
        });
        const item = Items?.[0] as Invoice | undefined;
        if (!item) return null;
        return { invoice: item, ownerId: item.createdBy };
    }

    async listOrgInvoicesPaginated(params: ListInvoicesPaginatedParams): Promise<PaginatedResult<Invoice>> {
        const { orgId, limit = 20, exclusiveStartKey, status, isQuote } = params;

        const filterParts: string[] = [];
        const names: Record<string, string> = {};
        const values: Record<string, any> = { ':orgId': orgId };

        // Exclude payment links (safe for legacy records without the attribute)
        filterParts.push('(attribute_not_exists(#isPaymentLink) OR #isPaymentLink = :false)');
        names['#isPaymentLink'] = 'isPaymentLink';
        values[':false'] = false;

        // Filter by isQuote
        if (isQuote === true) {
            filterParts.push('#isQuote = :isQuoteVal');
            names['#isQuote'] = 'isQuote';
            values[':isQuoteVal'] = true;
        } else if (isQuote === false) {
            filterParts.push('(attribute_not_exists(#isQuote) OR #isQuote = :isQuoteVal)');
            names['#isQuote'] = 'isQuote';
            values[':isQuoteVal'] = false;
        }

        // Filter by status
        if (status) {
            filterParts.push('#status = :status');
            names['#status'] = 'status';
            values[':status'] = status;
        }

        const result = await this.ddb.query({
            TableName: Tables.INVOICES,
            IndexName: 'CreatedAtIndex',
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: values,
            ...(Object.keys(names).length > 0 && { ExpressionAttributeNames: names }),
            ...(filterParts.length > 0 && { FilterExpression: filterParts.join(' AND ') }),
            ScanIndexForward: false,
            Limit: limit,
            ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
        });

        return {
            items: (result.Items as Invoice[]) ?? [],
            lastEvaluatedKey: result.LastEvaluatedKey,
        };
    }

    async listUserInvoices(orgId: string, userId: string): Promise<Invoice[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.INVOICES,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `${userId}#` },
        });
        return (Items as Invoice[]) ?? [];
    }

    async listAllOrgInvoices(orgId: string): Promise<Invoice[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.INVOICES,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return (Items as Invoice[]) ?? [];
    }

    async listDraftInvoices(orgId: string): Promise<Invoice[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.INVOICES,
            IndexName: 'CreatedAtIndex',
            KeyConditionExpression: 'orgId = :orgId',
            FilterExpression: '#status = :draft AND (attribute_not_exists(#isPaymentLink) OR #isPaymentLink = :false)',
            ExpressionAttributeNames: { '#status': 'status', '#isPaymentLink': 'isPaymentLink' },
            ExpressionAttributeValues: { ':orgId': orgId, ':draft': 'DRAFT', ':false': false },
        });
        return (Items as Invoice[]) ?? [];
    }

    async listOverdueInvoices(orgId: string, beforeDate: string): Promise<Invoice[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.INVOICES,
            IndexName: 'DueDateIndex',
            KeyConditionExpression: 'orgId = :orgId AND dueDateSk < :before',
            FilterExpression: '#status IN (:sent, :overdue)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':orgId': orgId, ':before': beforeDate, ':sent': 'SENT', ':overdue': 'OVERDUE' },
        });
        return (Items as Invoice[]) ?? [];
    }

    async createInvoice(orgId: string, userId: string, invoiceId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.INVOICES, {
            orgId,
            sk: sk(userId, invoiceId),
            invoiceId,
            createdBy: userId,
            ...data,
            dueDateSk: data.dueDate ? dueDateSk(data.dueDate, invoiceId) : undefined,
            createdAt: now,
            updatedAt: now,
        });
    }

    async updateInvoice(orgId: string, userId: string, invoiceId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = ['#updatedAt = :updatedAt'];
        const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
        const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };

        if (updates.dueDate) {
            updates.dueDateSk = dueDateSk(updates.dueDate, invoiceId);
        }

        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }

        await this.ddb.update(Tables.INVOICES, { orgId, sk: sk(userId, invoiceId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }

    async deleteInvoice(orgId: string, userId: string, invoiceId: string): Promise<void> {
        await this.ddb.delete(Tables.INVOICES, { orgId, sk: sk(userId, invoiceId) });
    }
}
