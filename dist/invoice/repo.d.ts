import { IDdb } from '../ddbPort';
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
export declare class InvoiceRepo {
    private ddb;
    constructor(ddb: IDdb);
    getInvoice(orgId: string, userId: string, invoiceId: string): Promise<Invoice | null>;
    findInvoiceByIdInOrg(orgId: string, invoiceId: string): Promise<{
        invoice: Invoice;
        ownerId: string;
    } | null>;
    listOrgInvoicesPaginated(params: ListInvoicesPaginatedParams): Promise<PaginatedResult<Invoice>>;
    listUserInvoices(orgId: string, userId: string): Promise<Invoice[]>;
    listAllOrgInvoices(orgId: string): Promise<Invoice[]>;
    listDraftInvoices(orgId: string): Promise<Invoice[]>;
    listOverdueInvoices(orgId: string, beforeDate: string): Promise<Invoice[]>;
    createInvoice(orgId: string, userId: string, invoiceId: string, data: Record<string, any>): Promise<void>;
    updateInvoice(orgId: string, userId: string, invoiceId: string, updates: Record<string, any>): Promise<void>;
    deleteInvoice(orgId: string, userId: string, invoiceId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map