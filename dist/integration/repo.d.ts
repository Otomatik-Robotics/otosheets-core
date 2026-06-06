import { IDdb } from '../ddbPort';
import { Integration } from './schema';
export declare class IntegrationRepo {
    private ddb;
    constructor(ddb: IDdb);
    getIntegration(ownerId: string, provider: string): Promise<Integration | null>;
    listIntegrations(ownerId: string): Promise<Integration[]>;
    putIntegration(ownerId: string, provider: string, data: Record<string, any>): Promise<void>;
    deleteIntegration(ownerId: string, provider: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map