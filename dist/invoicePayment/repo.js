"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvoicePaymentRepo = void 0;
const tables_1 = require("../tables");
const keys_1 = require("../keys");
class InvoicePaymentRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async listPayments(orgId, invoiceId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.INVOICE_PAYMENTS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `${invoiceId}#` },
        });
        return Items ?? [];
    }
    async recordPayment(orgId, invoiceId, invoiceUserId, paymentId, payment, newPaidAmount, newStatus) {
        const now = new Date().toISOString();
        await this.ddb.transactWrite([
            {
                Put: {
                    TableName: tables_1.Tables.INVOICE_PAYMENTS,
                    Item: {
                        orgId,
                        sk: (0, keys_1.invoicePaymentSk)(invoiceId, paymentId),
                        paymentId,
                        invoiceId,
                        ...payment,
                        createdAt: now,
                    },
                },
            },
            {
                Update: {
                    TableName: tables_1.Tables.INVOICES,
                    Key: { orgId, sk: (0, keys_1.sk)(invoiceUserId, invoiceId) },
                    UpdateExpression: 'SET paidAmount = :paidAmount, #status = :status, updatedAt = :now',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':paidAmount': newPaidAmount,
                        ':status': newStatus,
                        ':now': now,
                    },
                },
            },
        ]);
    }
}
exports.InvoicePaymentRepo = InvoicePaymentRepo;
//# sourceMappingURL=repo.js.map