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
    async findInvoiceByIdInOrg(orgId, invoiceId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.INVOICES,
            IndexName: 'InvoiceIdIndex',
            KeyConditionExpression: 'orgId = :orgId AND invoiceId = :invoiceId',
            ExpressionAttributeValues: { ':orgId': orgId, ':invoiceId': invoiceId },
            Limit: 1,
        });
        const item = Items?.[0];
        if (!item)
            return null;
        return { invoice: item, ownerId: item.createdBy };
    }
    async listOrgInvoicesPaginated(params) {
        const { orgId, limit = 20, exclusiveStartKey, status, isQuote } = params;
        const filterParts = [];
        const names = {};
        const values = { ':orgId': orgId };
        // Exclude payment links (safe for legacy records without the attribute)
        filterParts.push('(attribute_not_exists(#isPaymentLink) OR #isPaymentLink = :false)');
        names['#isPaymentLink'] = 'isPaymentLink';
        values[':false'] = false;
        // Filter by isQuote
        if (isQuote === true) {
            filterParts.push('#isQuote = :isQuoteVal');
            names['#isQuote'] = 'isQuote';
            values[':isQuoteVal'] = true;
        }
        else if (isQuote === false) {
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
            TableName: tables_1.Tables.INVOICES,
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
            items: result.Items ?? [],
            lastEvaluatedKey: result.LastEvaluatedKey,
        };
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
    async listDraftInvoices(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.INVOICES,
            IndexName: 'CreatedAtIndex',
            KeyConditionExpression: 'orgId = :orgId',
            FilterExpression: '#status = :draft AND (attribute_not_exists(#isPaymentLink) OR #isPaymentLink = :false)',
            ExpressionAttributeNames: { '#status': 'status', '#isPaymentLink': 'isPaymentLink' },
            ExpressionAttributeValues: { ':orgId': orgId, ':draft': 'DRAFT', ':false': false },
        });
        return Items ?? [];
    }
    async listOverdueInvoices(orgId, beforeDate) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.INVOICES,
            IndexName: 'DueDateIndex',
            KeyConditionExpression: 'orgId = :orgId AND dueDateSk < :before',
            FilterExpression: '#status IN (:sent, :overdue)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':orgId': orgId, ':before': beforeDate, ':sent': 'SENT', ':overdue': 'OVERDUE' },
        });
        return Items ?? [];
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