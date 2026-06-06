import { IDdb } from '../ddbPort';
import type { DocumentStored } from './schema';
export declare class DocumentRepo {
    private ddb;
    constructor(ddb: IDdb);
    get(orgId: string, documentId: string): Promise<DocumentStored | null>;
    list(orgId: string): Promise<DocumentStored[]>;
    create(orgId: string, doc: Omit<DocumentStored, 'orgId' | 'sk' | 'createdAt'>): Promise<DocumentStored>;
    update(orgId: string, documentId: string, updates: Partial<Pick<DocumentStored, 'name' | 'description' | 'category'>>): Promise<void>;
    delete(orgId: string, documentId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map