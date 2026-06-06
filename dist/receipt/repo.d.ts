import { IDdb } from '../ddbPort';
import { Receipt } from './schema';
export declare class ReceiptRepo {
    private ddb;
    constructor(ddb: IDdb);
    getReceipt(orgId: string, userId: string, receiptId: string): Promise<Receipt | null>;
    findReceiptByIdInOrg(orgId: string, receiptId: string): Promise<{
        receipt: Receipt;
        ownerId: string;
    } | null>;
    findReceiptByDescriptionPrefix(orgId: string, prefix: string): Promise<Receipt | null>;
    findReceiptByContentHash(orgId: string, contentHash: string): Promise<Receipt | null>;
    findReceiptsByDuplicateOf(orgId: string, receiptId: string): Promise<Receipt[]>;
    listAllOrgReceipts(orgId: string): Promise<Receipt[]>;
    listUserReceipts(orgId: string, userId: string): Promise<Receipt[]>;
    listReceiptsByDate(orgId: string, from: string, to: string, projection?: string): Promise<Receipt[]>;
    createReceipt(orgId: string, userId: string, receiptId: string, data: Record<string, any>): Promise<void>;
    updateReceipt(orgId: string, userId: string, receiptId: string, updates: Record<string, any>): Promise<void>;
    deleteReceipt(orgId: string, userId: string, receiptId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map