import { IDdb } from '../ddbPort';
import { Client } from './schema';
import { PaginatedResult } from '../types';
export declare class ClientRepo {
    private ddb;
    constructor(ddb: IDdb);
    getClient(orgId: string, clientId: string): Promise<Client | null>;
    listClients(orgId: string): Promise<Client[]>;
    listClientsPaginated(params: {
        orgId: string;
        limit?: number;
        exclusiveStartKey?: Record<string, any>;
    }): Promise<PaginatedResult<Client>>;
    findClientByEmail(orgId: string, email: string): Promise<Client | null>;
    createClient(orgId: string, clientId: string, data: Record<string, any>): Promise<void>;
    updateClient(orgId: string, clientId: string, updates: Record<string, any>): Promise<void>;
    batchGetClients(orgId: string, clientIds: string[]): Promise<Client[]>;
    deleteClient(orgId: string, clientId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map