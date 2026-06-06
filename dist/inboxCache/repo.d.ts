import { IDdb } from '../ddbPort';
import { InboxCache } from './schema';
export declare class InboxCacheRepo {
    private ddb;
    constructor(ddb: IDdb);
    getEntry(userId: string, gmailId: string): Promise<InboxCache | null>;
    listByUser(userId: string, opts?: {
        limit?: number;
    }): Promise<InboxCache[]>;
    putEntry(data: InboxCache): Promise<void>;
    deleteEntry(userId: string, gmailId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map