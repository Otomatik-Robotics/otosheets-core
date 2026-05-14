import { IDdb } from '../ddbPort';
import { OrgChannel } from './schema';
export declare class OrgChannelRepo {
    private ddb;
    constructor(ddb: IDdb);
    getOrgChannel(orgId: string, channelId: string): Promise<OrgChannel | null>;
    listOrgChannels(orgId: string): Promise<OrgChannel[]>;
    createOrgChannel(orgId: string, channelId: string, data: Record<string, any>): Promise<void>;
    updateOrgChannel(orgId: string, channelId: string, updates: Record<string, any>): Promise<void>;
    deleteOrgChannel(orgId: string, channelId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map