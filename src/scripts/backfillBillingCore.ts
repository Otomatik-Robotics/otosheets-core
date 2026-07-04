/**
 * Phase-2 backfill: DynamoDB → Postgres for billing-core (clients, invoices,
 * payments) — docs/POSTGRES_MIGRATION_PLAN.md §6.3.
 *
 * `--report` validates every row through the same DTO→row transform the real
 * write uses (NOT NULL + unknown-attribute checks) WITHOUT touching Postgres —
 * needs only Dynamo read access. Run this BEFORE flipping billing-core to
 * dual_dynamo; resolve every skip (add columns for legacy fields, etc.) first.
 *
 * Usage:
 *   export AWS_PROFILE=sandbox AWS_REGION=ap-southeast-2
 *   export CLIENTS_TABLE=... INVOICES_TABLE=... INVOICE_PAYMENTS_TABLE=... ORGANIZATIONS_TABLE=...
 *   export DATABASE_URL=...   # only needed without --report
 *   node dist/scripts/backfillBillingCore.js --report
 */
import { ddb } from '../ddbClient';
import { Tables } from '../tables';
import { toRow } from '../pg/rows';
import * as pgSchema from '../pg/schema';
import { ClientPgRepo } from '../client/repo.pg';
import { InvoicePgRepo } from '../invoice/repo.pg';
import { InvoicePaymentPgRepo } from '../invoicePayment/repo.pg';

interface Counts { scanned: number; ok: number; skipped: { reason: string; key: string }[]; }

async function* scanAll(tableName: string): AsyncGenerator<Record<string, any>> {
    let exclusiveStartKey: Record<string, any> | undefined;
    do {
        const page = await ddb.scan({ TableName: tableName, ExclusiveStartKey: exclusiveStartKey });
        for (const item of page.Items ?? []) yield item;
        exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);
}

async function run(
    label: string, tableName: string,
    keyOf: (i: any) => string, validate: (i: any) => void, write: (i: any) => Promise<void>,
    reportOnly: boolean,
): Promise<Counts> {
    const counts: Counts = { scanned: 0, ok: 0, skipped: [] };
    for await (const item of scanAll(tableName)) {
        counts.scanned++;
        try {
            if (reportOnly) validate(item); else await write(item);
            counts.ok++;
        } catch (err: any) {
            counts.skipped.push({ reason: err?.message ?? String(err), key: keyOf(item) });
        }
        if (counts.scanned % 500 === 0) console.log(`[${label}] scanned ${counts.scanned}...`);
    }
    console.log(`[${label}] scanned=${counts.scanned} ${reportOnly ? 'validated' : 'wrote'}=${counts.ok} skipped=${counts.skipped.length}`);
    for (const s of counts.skipped) console.warn(`[${label}] SKIPPED ${s.key}: ${s.reason}`);
    return counts;
}

function requireFields(item: Record<string, any>, fields: string[]): void {
    const missing = fields.filter(f => item[f] === undefined || item[f] === null || item[f] === '');
    if (missing.length > 0) throw new Error(`missing required (NOT NULL) field(s): ${missing.join(', ')}`);
}

export async function backfillBillingCore(reportOnly: boolean): Promise<void> {
    const clientPg = new ClientPgRepo();
    const invoicePg = new InvoicePgRepo();
    const paymentPg = new InvoicePaymentPgRepo();

    // Offline validators mirroring the pg NOT NULL + strict toRow (unknown-attr) checks.
    // Validators mirror the repos' row transform, including the legacy-field remaps.
    const vClient = (i: any) => {
        requireFields(i, ['clientId', 'orgId', 'createdBy', 'name']);
        const { contacts, contact, contactPerson, ...rest } = i;
        toRow(pgSchema.clients, { ...rest, legacyContact: contact ?? null, legacyContactPerson: contactPerson ?? null }, 'client');
    };
    const vInvoice = (i: any) => {
        requireFields(i, ['invoiceId', 'orgId', 'invoiceNumber']);
        const { sk, dueDateSk, items, clientSnapshot, lineItems, ...rest } = i;
        const ownerId = typeof sk === 'string' ? sk.split('#')[0] : i.createdBy;
        toRow(pgSchema.invoices, { ...rest, ownerId, legacyClientSnapshot: clientSnapshot ?? null, legacyLineItems: lineItems ?? null }, 'invoice');
    };
    const vPayment = (i: any) => {
        requireFields(i, ['paymentId', 'invoiceId', 'orgId', 'amount', 'method']);
        const { sk, ...rest } = i;
        toRow(pgSchema.invoicePayments, rest, 'invoicePayment');
    };

    console.log(`billing-core backfill (${reportOnly ? 'REPORT-ONLY' : 'WRITE'})`);
    // FK order: clients (→orgs) first, then invoices (→clients), then payments (→invoices).
    const results = {
        clients: await run('clients', Tables.CLIENTS, (i) => i.clientId, vClient, (i) => { const { contacts, ...rest } = i; return clientPg.createClient(i.orgId, i.clientId, { ...rest, contacts }); }, reportOnly),
        invoices: await run('invoices', Tables.INVOICES, (i) => i.invoiceId, vInvoice, (i) => invoicePg.upsertInvoice(i), reportOnly),
        payments: await run('payments', Tables.INVOICE_PAYMENTS, (i) => i.paymentId ?? i.sk, vPayment, (i) => paymentPg.upsertPayment(i), reportOnly),
    };

    const total = Object.values(results).reduce((n, c) => n + c.skipped.length, 0);
    console.log(`billing-core backfill complete — total skipped: ${total}`);
    if (total > 0) { console.log('Resolve skips before promotion (§6.3 gate).'); process.exitCode = 2; }
}

if (require.main === module) {
    backfillBillingCore(process.argv.includes('--report')).catch((err) => {
        console.error('billing-core backfill failed:', err);
        process.exit(1);
    });
}
