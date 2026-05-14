import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { invoicePaymentSk, sk } from '../keys';
import { InvoicePayment } from './schema';

export class InvoicePaymentRepo {
    constructor(private ddb: IDdb) {}

    async listPayments(orgId: string, invoiceId: string): Promise<InvoicePayment[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.INVOICE_PAYMENTS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `${invoiceId}#` },
        });
        return (Items as InvoicePayment[]) ?? [];
    }

    async recordPayment(
        orgId: string,
        invoiceId: string,
        invoiceUserId: string,
        paymentId: string,
        payment: Record<string, any>,
        newPaidAmount: number,
        newStatus: string,
    ): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.transactWrite([
            {
                Put: {
                    TableName: Tables.INVOICE_PAYMENTS,
                    Item: {
                        orgId,
                        sk: invoicePaymentSk(invoiceId, paymentId),
                        paymentId,
                        invoiceId,
                        ...payment,
                        createdAt: now,
                    },
                },
            },
            {
                Update: {
                    TableName: Tables.INVOICES,
                    Key: { orgId, sk: sk(invoiceUserId, invoiceId) },
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
