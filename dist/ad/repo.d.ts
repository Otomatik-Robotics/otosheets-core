import { IDdb } from '../ddbPort';
import { Ad } from './schema';
export declare class AdRepo {
    private ddb;
    constructor(ddb: IDdb);
    getAd(orgId: string, userId: string, adId: string): Promise<Ad | null>;
    listAllOrgAds(orgId: string): Promise<Ad[]>;
    listUserAds(orgId: string, userId: string): Promise<Ad[]>;
    createAd(orgId: string, userId: string, adId: string, data: Record<string, any>): Promise<void>;
    deleteAd(orgId: string, userId: string, adId: string): Promise<void>;
    updateAd(orgId: string, userId: string, adId: string, updates: Record<string, any>): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map