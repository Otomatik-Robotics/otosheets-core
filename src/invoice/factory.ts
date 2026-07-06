import { resolveRoute, type Route } from '../dataBackend';
import { mirrorWrite, shadowRead } from '../dualWrite';
import { ddb } from '../ddbClient';
import type { IDdb } from '../ddbPort';
import { PaginatedResult } from '../types';
import { Invoice } from './schema';
import type { InvoiceSummary } from './summary';
import { InvoiceDynamoRepo, type IInvoiceRepo, type ListInvoicesPaginatedParams } from './repo';
import { InvoicePgRepo } from './repo.pg';

const DOMAIN = 'billing-core' as const;
const ENTITY = 'invoice';

/** State-machine router for invoices — see user/factory.ts for the pattern notes. */
export class RoutingInvoiceRepo implements IInvoiceRepo {
    constructor(private dynamo: IInvoiceRepo, private pg: IInvoiceRepo) {}

    private pick(r: Route): IInvoiceRepo { return r.primary === 'dynamo' ? this.dynamo : this.pg; }
    private mirrorOf(r: Route): IInvoiceRepo | undefined {
        if (!r.mirror) return undefined;
        return r.mirror === 'dynamo' ? this.dynamo : this.pg;
    }
    private async mirrorEntity(route: Route, orgId: string, userId: string, invoiceId: string, op: string): Promise<void> {
        const mirror = this.mirrorOf(route);
        if (!mirror) return;
        await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op, key: { orgId, userId, invoiceId } }, async () => {
            const fresh = await this.pick(route).getInvoice(orgId, userId, invoiceId);
            if (fresh) await mirror.upsertInvoice(fresh);
            else await mirror.deleteInvoice(orgId, userId, invoiceId);
        });
    }

    async getInvoice(orgId: string, userId: string, invoiceId: string): Promise<Invoice | null> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).getInvoice(orgId, userId, invoiceId);
        if (route.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'getInvoice' }, result, () => this.pg.getInvoice(orgId, userId, invoiceId));
        return result;
    }
    async findInvoiceByIdInOrg(orgId: string, invoiceId: string): Promise<{ invoice: Invoice; ownerId: string } | null> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).findInvoiceByIdInOrg(orgId, invoiceId);
        if (route.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'findInvoiceByIdInOrg' }, result, () => this.pg.findInvoiceByIdInOrg(orgId, invoiceId));
        return result;
    }
    async listOrgInvoicesPaginated(params: ListInvoicesPaginatedParams): Promise<PaginatedResult<Invoice>> {
        // No shadow-read: store-shaped pagination cursors aren't like-for-like.
        return this.pick(await resolveRoute(DOMAIN)).listOrgInvoicesPaginated(params);
    }
    async listUserInvoices(orgId: string, userId: string): Promise<Invoice[]> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).listUserInvoices(orgId, userId);
        if (route.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'listUserInvoices' }, result, () => this.pg.listUserInvoices(orgId, userId));
        return result;
    }
    async listInvoicesByDate(orgId: string, from: string, to: string): Promise<Invoice[]> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).listInvoicesByDate(orgId, from, to);
        if (route.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'listInvoicesByDate' }, result, () => this.pg.listInvoicesByDate(orgId, from, to));
        return result;
    }
    async listAllOrgInvoices(orgId: string): Promise<Invoice[]> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).listAllOrgInvoices(orgId);
        if (route.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'listAllOrgInvoices' }, result, () => this.pg.listAllOrgInvoices(orgId));
        return result;
    }
    async listDraftInvoices(orgId: string): Promise<Invoice[]> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).listDraftInvoices(orgId);
        if (route.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'listDraftInvoices' }, result, () => this.pg.listDraftInvoices(orgId));
        return result;
    }
    async listOverdueInvoices(orgId: string, beforeDate: string): Promise<Invoice[]> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).listOverdueInvoices(orgId, beforeDate);
        if (route.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'listOverdueInvoices' }, result, () => this.pg.listOverdueInvoices(orgId, beforeDate));
        return result;
    }
    async getInvoiceSummary(orgId: string): Promise<InvoiceSummary> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).getInvoiceSummary(orgId);
        if (route.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'getInvoiceSummary' }, result, () => this.pg.getInvoiceSummary(orgId));
        return result;
    }

    async createInvoice(orgId: string, userId: string, invoiceId: string, data: Record<string, any>): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).createInvoice(orgId, userId, invoiceId, data);
        await this.mirrorEntity(route, orgId, userId, invoiceId, 'createInvoice');
    }
    async updateInvoice(orgId: string, userId: string, invoiceId: string, updates: Record<string, any>): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).updateInvoice(orgId, userId, invoiceId, updates);
        await this.mirrorEntity(route, orgId, userId, invoiceId, 'updateInvoice');
    }
    async deleteInvoice(orgId: string, userId: string, invoiceId: string): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).deleteInvoice(orgId, userId, invoiceId);
        const mirror = this.mirrorOf(route);
        if (mirror) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'deleteInvoice', key: { orgId, userId, invoiceId } }, () => mirror.deleteInvoice(orgId, userId, invoiceId));
    }
    async upsertInvoice(invoice: Invoice): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).upsertInvoice(invoice);
        const mirror = this.mirrorOf(route);
        if (mirror) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'upsertInvoice', key: { orgId: (invoice as any).orgId, invoiceId: (invoice as any).invoiceId } }, () => mirror.upsertInvoice(invoice));
    }
}

/** Drop-in continuation — `new InvoiceRepo(ddb)` now routes on the billing-core flag. */
export class InvoiceRepo extends RoutingInvoiceRepo {
    constructor(dynamoDb: IDdb) {
        super(new InvoiceDynamoRepo(dynamoDb), new InvoicePgRepo());
    }
}

let singleton: IInvoiceRepo | undefined;
export function getInvoiceRepo(): IInvoiceRepo {
    if (!singleton) singleton = new InvoiceRepo(ddb);
    return singleton;
}
