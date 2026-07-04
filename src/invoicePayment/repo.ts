import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { invoicePaymentSk, sk } from '../keys';
import { InvoicePayment } from './schema';

/** Store-agnostic contract — implemented by InvoicePaymentDynamoRepo and InvoicePaymentPgRepo; InvoicePaymentRepo (factory.ts) routes. */
export interface IInvoicePaymentRepo {
    listPayments(orgId: string, invoiceId: string): Promise<InvoicePayment[]>;
    recordPayment(
        orgId: string, invoiceId: string, invoiceUserId: string, paymentId: string,
        payment: Record<string, any>, newPaidAmount: number, newStatus: string,
    ): Promise<void>;
    /** Full-entity mirror upsert used by the dual-write router (plan §6.1). */
    upsertPayment(payment: InvoicePayment): Promise<void>;
    deletePayment(orgId: string, invoiceId: string, paymentId: string): Promise<void>;
}

export class InvoicePaymentDynamoRepo implements IInvoicePaymentRepo {
    constructor(private ddb: IDdb) {}

    async upsertPayment(payment: InvoicePayment): Promise<void> {
        await this.ddb.put(Tables.INVOICE_PAYMENTS, payment);
    }

    async deletePayment(orgId: string, invoiceId: string, paymentId: string): Promise<void> {
        await this.ddb.delete(Tables.INVOICE_PAYMENTS, { orgId, sk: invoicePaymentSk(invoiceId, paymentId) });
    }

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
