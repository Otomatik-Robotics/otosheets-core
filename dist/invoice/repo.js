"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvoiceRepo = void 0;
const tables_1 = require("../tables");
const keys_1 = require("../keys");
class InvoiceRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getInvoice(orgId, userId, invoiceId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.INVOICES, { orgId, sk: (0, keys_1.sk)(userId, invoiceId) });
        return Item ?? null;
    }
    async listUserInvoices(orgId, userId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.INVOICES,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `${userId}#` },
        });
        return Items ?? [];
    }
    async listAllOrgInvoices(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.INVOICES,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return Items ?? [];
    }
    async listOverdueInvoices(orgId, beforeDate) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.INVOICES,
            IndexName: 'DueDateIndex',
            KeyConditionExpression: 'orgId = :orgId AND dueDateSk < :before',
            ExpressionAttributeValues: { ':orgId': orgId, ':before': beforeDate },
        });
        return (Items ?? []).filter(i => i.status === 'SENT' || i.status === 'OVERDUE');
    }
    async createInvoice(orgId, userId, invoiceId, data) {
        const now = new Date().toISOString();
        await this.ddb.put(tables_1.Tables.INVOICES, {
            orgId,
            sk: (0, keys_1.sk)(userId, invoiceId),
            invoiceId,
            createdBy: userId,
            ...data,
            dueDateSk: data.dueDate ? (0, keys_1.dueDateSk)(data.dueDate, invoiceId) : undefined,
            createdAt: now,
            updatedAt: now,
        });
    }
    async updateInvoice(orgId, userId, invoiceId, updates) {
        const sets = ['#updatedAt = :updatedAt'];
        const names = { '#updatedAt': 'updatedAt' };
        const values = { ':updatedAt': new Date().toISOString() };
        if (updates.dueDate) {
            updates.dueDateSk = (0, keys_1.dueDateSk)(updates.dueDate, invoiceId);
        }
        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }
        await this.ddb.update(tables_1.Tables.INVOICES, { orgId, sk: (0, keys_1.sk)(userId, invoiceId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
    async deleteInvoice(orgId, userId, invoiceId) {
        await this.ddb.delete(tables_1.Tables.INVOICES, { orgId, sk: (0, keys_1.sk)(userId, invoiceId) });
    }
}
exports.InvoiceRepo = InvoiceRepo;
//# sourceMappingURL=repo.js.map