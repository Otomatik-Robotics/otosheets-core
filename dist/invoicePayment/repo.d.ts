import { IDdb } from '../ddbPort';
import { InvoicePayment } from './schema';
export declare class InvoicePaymentRepo {
    private ddb;
    constructor(ddb: IDdb);
    listPayments(orgId: string, invoiceId: string): Promise<InvoicePayment[]>;
    recordPayment(orgId: string, invoiceId: string, invoiceUserId: string, paymentId: string, payment: Record<string, any>, newPaidAmount: number, newStatus: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map