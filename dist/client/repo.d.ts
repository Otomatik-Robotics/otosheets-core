import { IDdb } from '../ddbPort';
import { Client } from './schema';
export declare class ClientRepo {
    private ddb;
    constructor(ddb: IDdb);
    getClient(orgId: string, clientId: string): Promise<Client | null>;
    listClients(orgId: string): Promise<Client[]>;
    createClient(orgId: string, clientId: string, data: Record<string, any>): Promise<void>;
    updateClient(orgId: string, clientId: string, updates: Record<string, any>): Promise<void>;
    deleteClient(orgId: string, clientId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map