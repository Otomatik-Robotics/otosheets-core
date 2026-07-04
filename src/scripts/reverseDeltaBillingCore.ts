/**
 * Reverse-delta backfill: Postgres → DynamoDB for billing-core (clients,
 * invoices, payments). Rollback path OUT of the `pg` state (plan §6.3 step 7 /
 * §11): after Dynamo mirroring stops, writes that landed only in Postgres are
 * copied back before stepping down to `dual_pg`. Must exist before billing-core
 * enters `pg`. Idempotent (full-item puts); safe to re-run.
 *
 * Usage:
 *   export AWS_PROFILE=... AWS_REGION=ap-southeast-2
 *   export CLIENTS_TABLE=... INVOICES_TABLE=... INVOICE_PAYMENTS_TABLE=...
 *   export DATABASE_URL="postgresql://app_rw:...@.../neondb?sslmode=require"
 *   node dist/scripts/reverseDeltaBillingCore.js --since 2026-07-20T00:00:00Z
 */
import { gte, eq } from 'drizzle-orm';
import { getPg } from '../pg/client';
import { clients, invoices, invoicePayments } from '../pg/schema/billingCore';
import { ddb } from '../ddbClient';
import { ClientDynamoRepo } from '../client/repo';
import { InvoiceDynamoRepo } from '../invoice/repo';
import { InvoicePaymentDynamoRepo } from '../invoicePayment/repo';
import { ClientPgRepo } from '../client/repo.pg';
import { InvoicePgRepo } from '../invoice/repo.pg';
import { InvoicePaymentPgRepo } from '../invoicePayment/repo.pg';

export async function reverseDeltaBillingCore(sinceIso: string): Promise<void> {
    const since = new Date(sinceIso);
    if (Number.isNaN(since.getTime())) throw new Error(`--since is not a valid instant: ${sinceIso}`);
    const db = getPg();

    const clientDyn = new ClientDynamoRepo(ddb);
    const invoiceDyn = new InvoiceDynamoRepo(ddb);
    const paymentDyn = new InvoicePaymentDynamoRepo(ddb);
    const clientPg = new ClientPgRepo();
    const invoicePg = new InvoicePgRepo();
    const paymentPg = new InvoicePaymentPgRepo();

    console.log(`reverse delta (billing-core) since ${since.toISOString()}`);

    // Clients — hydrate via the pg repo (rebuilds contacts + legacy fields), upsert to Dynamo.
    const changedClients = await db.select({ orgId: clients.orgId, clientId: clients.clientId })
        .from(clients).where(gte(clients.updatedAt, since));
    for (const c of changedClients as any[]) {
        const full = await clientPg.getClient(c.orgId, c.clientId);
        if (full) await clientDyn.upsertClient(full);
    }
    console.log(`clients: ${changedClients.length}`);

    // Invoices — hydrate (reconstructs sk/dueDateSk/items/clientSnapshot), upsert to Dynamo.
    const changedInvoices = await db.select({ orgId: invoices.orgId, invoiceId: invoices.invoiceId })
        .from(invoices).where(gte(invoices.updatedAt, since));
    for (const i of changedInvoices as any[]) {
        const full = await invoicePg.getInvoice(i.orgId, '', i.invoiceId);
        if (full) await invoiceDyn.upsertInvoice(full);
    }
    console.log(`invoices: ${changedInvoices.length}`);

    // Payments — immutable, keyed on created_at; copy those created since the freeze.
    const changedPayments = await db.select({ orgId: invoicePayments.orgId, invoiceId: invoicePayments.invoiceId })
        .from(invoicePayments).where(gte(invoicePayments.createdAt, since));
    const seen = new Set<string>();
    for (const p of changedPayments as any[]) {
        const key = `${p.orgId}#${p.invoiceId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        for (const payment of await paymentPg.listPayments(p.orgId, p.invoiceId)) {
            await paymentDyn.upsertPayment(payment);
        }
    }
    console.log(`payments: re-copied for ${seen.size} invoice(s)`);
    console.log('reverse delta complete. Deletions since the freeze are NOT replayed — reconcile counts before relying on Dynamo.');
}

if (require.main === module) {
    const idx = process.argv.indexOf('--since');
    const sinceIso = idx >= 0 ? process.argv[idx + 1] : '';
    if (!sinceIso) { console.error('Usage: node dist/scripts/reverseDeltaBillingCore.js --since <ISO instant>'); process.exit(1); }
    reverseDeltaBillingCore(sinceIso).catch((err) => { console.error('reverse delta failed:', err); process.exit(1); });
}
