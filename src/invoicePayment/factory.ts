import { resolveRoute, type Route } from '../dataBackend';
import { mirrorWrite, shadowRead } from '../dualWrite';
import { ddb } from '../ddbClient';
import type { IDdb } from '../ddbPort';
import { InvoicePayment } from './schema';
import { InvoicePaymentDynamoRepo, type IInvoicePaymentRepo } from './repo';
import { InvoicePaymentPgRepo } from './repo.pg';

const DOMAIN = 'billing-core' as const;
const ENTITY = 'invoicePayment';

/** State-machine router for invoice payments — see user/factory.ts for the pattern notes. */
export class RoutingInvoicePaymentRepo implements IInvoicePaymentRepo {
    constructor(private dynamo: IInvoicePaymentRepo, private pg: IInvoicePaymentRepo) {}

    private pick(r: Route): IInvoicePaymentRepo { return r.primary === 'dynamo' ? this.dynamo : this.pg; }
    private mirrorOf(r: Route): IInvoicePaymentRepo | undefined {
        if (!r.mirror) return undefined;
        return r.mirror === 'dynamo' ? this.dynamo : this.pg;
    }

    async listPayments(orgId: string, invoiceId: string): Promise<InvoicePayment[]> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).listPayments(orgId, invoiceId);
        if (route.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'listPayments' }, result, () => this.pg.listPayments(orgId, invoiceId));
        return result;
    }

    async recordPayment(
        orgId: string, invoiceId: string, invoiceUserId: string, paymentId: string,
        payment: Record<string, any>, newPaidAmount: number, newStatus: string,
    ): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).recordPayment(orgId, invoiceId, invoiceUserId, paymentId, payment, newPaidAmount, newStatus);
        const mirror = this.mirrorOf(route);
        if (mirror) {
            // Replay the same idempotent compound write on the mirror — reproduces
            // the payment insert AND the invoice paidAmount/status roll atomically.
            await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'recordPayment', key: { orgId, invoiceId, paymentId } },
                () => mirror.recordPayment(orgId, invoiceId, invoiceUserId, paymentId, payment, newPaidAmount, newStatus));
        }
    }

    async upsertPayment(payment: InvoicePayment): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).upsertPayment(payment);
        const mirror = this.mirrorOf(route);
        if (mirror) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'upsertPayment', key: { paymentId: payment.paymentId } }, () => mirror.upsertPayment(payment));
    }

    async deletePayment(orgId: string, invoiceId: string, paymentId: string): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).deletePayment(orgId, invoiceId, paymentId);
        const mirror = this.mirrorOf(route);
        if (mirror) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'deletePayment', key: { orgId, invoiceId, paymentId } }, () => mirror.deletePayment(orgId, invoiceId, paymentId));
    }
}

/** Drop-in continuation — `new InvoicePaymentRepo(ddb)` now routes on the billing-core flag. */
export class InvoicePaymentRepo extends RoutingInvoicePaymentRepo {
    constructor(dynamoDb: IDdb) {
        super(new InvoicePaymentDynamoRepo(dynamoDb), new InvoicePaymentPgRepo());
    }
}

let singleton: IInvoicePaymentRepo | undefined;
export function getInvoicePaymentRepo(): IInvoicePaymentRepo {
    if (!singleton) singleton = new InvoicePaymentRepo(ddb);
    return singleton;
}
