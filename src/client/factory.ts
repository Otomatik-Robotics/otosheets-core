import { resolveRoute, type Route } from '../dataBackend';
import { mirrorWrite, shadowRead } from '../dualWrite';
import { ddb } from '../ddbClient';
import type { IDdb } from '../ddbPort';
import { PaginatedResult } from '../types';
import { Client } from './schema';
import { ClientDynamoRepo, type IClientRepo, type ListClientsPaginatedParams } from './repo';
import { ClientPgRepo } from './repo.pg';

const DOMAIN = 'billing-core' as const;
const ENTITY = 'client';

/** State-machine router for clients — see user/factory.ts for the pattern notes. */
export class RoutingClientRepo implements IClientRepo {
    constructor(private dynamo: IClientRepo, private pg: IClientRepo) {}

    private pick(r: Route): IClientRepo { return r.primary === 'dynamo' ? this.dynamo : this.pg; }
    private mirrorOf(r: Route): IClientRepo | undefined {
        if (!r.mirror) return undefined;
        return r.mirror === 'dynamo' ? this.dynamo : this.pg;
    }
    private async mirrorEntity(route: Route, orgId: string, clientId: string, op: string): Promise<void> {
        const mirror = this.mirrorOf(route);
        if (!mirror) return;
        await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op, key: { orgId, clientId } }, async () => {
            const fresh = await this.pick(route).getClient(orgId, clientId);
            if (fresh) await mirror.upsertClient(fresh);
            else await mirror.deleteClient(orgId, clientId);
        });
    }

    async getClient(orgId: string, clientId: string): Promise<Client | null> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).getClient(orgId, clientId);
        if (route.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'getClient' }, result, () => this.pg.getClient(orgId, clientId));
        return result;
    }
    async listClients(orgId: string): Promise<Client[]> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).listClients(orgId);
        if (route.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'listClients' }, result, () => this.pg.listClients(orgId));
        return result;
    }
    async listClientsPaginated(params: ListClientsPaginatedParams): Promise<PaginatedResult<Client>> {
        const route = await resolveRoute(DOMAIN);
        // No shadow-read: pagination cursors are store-shaped, so a parallel pg
        // read with a Dynamo cursor is not a like-for-like comparison.
        return this.pick(route).listClientsPaginated(params);
    }
    async findClientByEmail(orgId: string, email: string): Promise<Client | null> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).findClientByEmail(orgId, email);
        if (route.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'findClientByEmail' }, result, () => this.pg.findClientByEmail(orgId, email));
        return result;
    }
    async countClients(orgId: string): Promise<number> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).countClients(orgId);
        if (route.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'countClients' }, result, () => this.pg.countClients(orgId));
        return result;
    }
    async listClientEmails(orgId: string): Promise<Array<{ clientId: string; email: string; name: string }>> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).listClientEmails(orgId);
        if (route.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'listClientEmails' }, result, () => this.pg.listClientEmails(orgId));
        return result;
    }
    async batchGetClients(orgId: string, clientIds: string[]): Promise<Client[]> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).batchGetClients(orgId, clientIds);
        if (route.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'batchGetClients' }, result, () => this.pg.batchGetClients(orgId, clientIds));
        return result;
    }
    async getTopByUsage(orgId: string, limit?: number): Promise<Client[]> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).getTopByUsage(orgId, limit);
        if (route.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'getTopByUsage' }, result, () => this.pg.getTopByUsage(orgId, limit));
        return result;
    }

    async createClient(orgId: string, clientId: string, data: Record<string, any>): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).createClient(orgId, clientId, data);
        await this.mirrorEntity(route, orgId, clientId, 'createClient');
    }
    async updateClient(orgId: string, clientId: string, updates: Record<string, any>): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).updateClient(orgId, clientId, updates);
        await this.mirrorEntity(route, orgId, clientId, 'updateClient');
    }
    async incrementPaymentLinkUsage(orgId: string, clientId: string): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).incrementPaymentLinkUsage(orgId, clientId);
        await this.mirrorEntity(route, orgId, clientId, 'incrementPaymentLinkUsage');
    }
    async deleteClient(orgId: string, clientId: string): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).deleteClient(orgId, clientId);
        const mirror = this.mirrorOf(route);
        if (mirror) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'deleteClient', key: { orgId, clientId } }, () => mirror.deleteClient(orgId, clientId));
    }
    async upsertClient(client: Client): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).upsertClient(client);
        const mirror = this.mirrorOf(route);
        if (mirror) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'upsertClient', key: { orgId: client.orgId, clientId: client.clientId } }, () => mirror.upsertClient(client));
    }
}

/** Drop-in continuation — `new ClientRepo(ddb)` now routes on the billing-core flag. */
export class ClientRepo extends RoutingClientRepo {
    constructor(dynamoDb: IDdb) {
        super(new ClientDynamoRepo(dynamoDb), new ClientPgRepo());
    }
}

let singleton: IClientRepo | undefined;
export function getClientRepo(): IClientRepo {
    if (!singleton) singleton = new ClientRepo(ddb);
    return singleton;
}
