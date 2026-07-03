/**
 * Phase-2 prep (plan §11): audit invoice numbers for duplicates.
 *
 * The target Postgres schema wants `UNIQUE (org_id, invoice_number)`; legacy
 * data may violate it. This scan reports duplicate (orgId, invoiceNumber)
 * pairs so they can be resolved before the unique index lands (until then it
 * ships as a plain index — §4/§9).
 *
 * Usage:
 *   export AWS_PROFILE=sandbox AWS_REGION=ap-southeast-2
 *   export INVOICES_TABLE=otosheets-invoices-dev
 *   node dist/scripts/auditInvoiceNumbers.js
 *
 * Read-only; exits 2 when duplicates exist (CI-friendly).
 */
import { ddb } from '../ddbClient';
import { Tables } from '../tables';

export async function auditInvoiceNumbers(): Promise<number> {
    const seen = new Map<string, string[]>(); // orgId#invoiceNumber -> [sk, ...]
    let scanned = 0;
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
        const page = await ddb.scan({
            TableName: Tables.INVOICES,
            ProjectionExpression: 'orgId, sk, invoiceNumber, isQuote, isPaymentLink',
            ExclusiveStartKey: exclusiveStartKey,
        });
        for (const item of page.Items ?? []) {
            scanned++;
            // Quotes and payment links share the table but have their own
            // numbering semantics — the unique index targets real invoices.
            if (item.isQuote === true || item.isPaymentLink === true) continue;
            if (!item.invoiceNumber) continue;
            const key = `${item.orgId}#${item.invoiceNumber}`;
            const list = seen.get(key) ?? [];
            list.push(item.sk);
            seen.set(key, list);
        }
        exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);

    const duplicates = [...seen.entries()].filter(([, sks]) => sks.length > 1);
    console.log(`scanned ${scanned} rows; ${duplicates.length} duplicate (orgId, invoiceNumber) pairs`);
    for (const [key, sks] of duplicates) {
        console.warn(`DUPLICATE ${key}: ${sks.join(', ')}`);
    }
    if (duplicates.length === 0) {
        console.log('Clean — the phase-2 UNIQUE (org_id, invoice_number) index can land.');
    } else {
        console.log('Resolve duplicates (renumber or merge) before promoting the unique index.');
    }
    return duplicates.length;
}

if (require.main === module) {
    auditInvoiceNumbers()
        .then((dupes) => process.exit(dupes > 0 ? 2 : 0))
        .catch((err) => {
            console.error('audit failed:', err);
            process.exit(1);
        });
}
