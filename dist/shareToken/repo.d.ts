import { IDdb } from '../ddbPort';
import { ShareToken } from './schema';
export declare class ShareTokenRepo {
    private ddb;
    constructor(ddb: IDdb);
    getToken(token: string): Promise<ShareToken | null>;
    listByUser(userId: string): Promise<ShareToken[]>;
    createToken(data: ShareToken): Promise<void>;
    incrementAccessCount(token: string): Promise<void>;
    deleteToken(token: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map