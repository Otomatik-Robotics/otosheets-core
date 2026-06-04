import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { sk, dueDateSk } from '../keys';
import { Invoice } from './schema';

export class InvoiceRepo {
    constructor(private ddb: IDdb) {}

    async getInvoice(orgId: string, userId: string, invoiceId: string): Promise<Invoice | null> {
        const { Item } = await this.ddb.getItem(Tables.INVOICES, { orgId, sk: sk(userId, invoiceId) });
        return (Item as Invoice) ?? null;
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
        const all = await this.listAllOrgInvoices(orgId);
        return all.filter(i => i.status === 'DRAFT');
    }

    async listOverdueInvoices(orgId: string, beforeDate: string): Promise<Invoice[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.INVOICES,
            IndexName: 'DueDateIndex',
            KeyConditionExpression: 'orgId = :orgId AND dueDateSk < :before',
            ExpressionAttributeValues: { ':orgId': orgId, ':before': beforeDate },
        });
        return ((Items as Invoice[]) ?? []).filter(i => i.status === 'SENT' || i.status === 'OVERDUE');
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
