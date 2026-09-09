import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { dataBackend } from '../dataBackend';
import { getPgTx, type PgDb } from '../pg/client';
import type { MatchSource } from './schema';

export interface InvoiceMatchMutationInput {
    userId: string;
    source: 'statement' | 'feed';
    txnId: string;
    invoiceId: string;
    action: 'accept' | 'reverse';
    matchSource?: MatchSource;
    writeOffRemainder?: boolean;
}
export type InvoiceMatchMutationResult =
    | { kind: 'not_found' | 'conflict' | 'invalid' }
    | { kind: 'applied' | 'replayed'; paymentId: string; invoiceStatus: string; invoicePaidAmount: number;
        amount: number; totalAmount: number; writeOffAmount: number };

/** Collision-resistant, source-bound identity; legacy sanitized IDs are never guessed. */
export function scopedMatchPaymentId(source: 'statement' | 'feed', txnId: string): string {
    return `bankmatch-v2-${source}-${createHash('sha256').update(txnId).digest('hex')}`;
}

/**
 * One transaction owns the parent, bank row, invoice and payment. Callers must
 * not compose this with a separate payment write/stamp. Legacy ambiguous links
 * and payment records are quarantined rather than repaired implicitly.
 */
export async function mutateScopedInvoiceMatch(
    scope: Readonly<{ orgId: string; businessProfileId: string }>,
    input: InvoiceMatchMutationInput,
    injected?: PgDb,
): Promise<InvoiceMatchMutationResult> {
    if (!scope.orgId?.trim() || !scope.businessProfileId?.trim()) throw new Error('Ledger matching scope is required');
    // A PG transaction cannot atomically uphold a Dynamo primary or mirror.
    // This does not change any cutover flag or retire rollback writers.
    if (await dataBackend('billing-core') !== 'pg') throw new Error('Atomic invoice matching requires billing-core pg');
    if (!input.userId || !input.txnId || !input.invoiceId
        || !['statement', 'feed'].includes(input.source) || !['accept', 'reverse'].includes(input.action)
        || (input.matchSource !== undefined && !['USER', 'AUTO'].includes(input.matchSource))) return { kind: 'invalid' };
    const child = sql.raw(input.source === 'statement' ? 'statement_transactions' : 'bank_transactions');
    const parent = sql.raw(input.source === 'statement' ? 'statements' : 'bank_accounts');
    const parentKey = sql.raw(input.source === 'statement' ? 'statement_id' : 'account_id');
    const paymentId = scopedMatchPaymentId(input.source, input.txnId);
    const rows = (result: any): any[] => result.rows ?? result;
    return (injected ?? getPgTx()).transaction(async tx => {
        const [row] = rows(await tx.execute(sql`SELECT t.* FROM ${child} t
            JOIN ${parent} p ON p.${parentKey} = t.${parentKey} AND p.user_id = t.user_id
            WHERE t.txn_id = ${input.txnId} AND t.user_id = ${input.userId}
              AND p.organization_id = ${scope.orgId} AND p.business_profile_id = ${scope.businessProfileId}
            FOR UPDATE OF p, t`));
        if (!row) return { kind: 'not_found' };
        const [invoice] = rows(await tx.execute(sql`SELECT * FROM invoices
            WHERE invoice_id = ${input.invoiceId} AND org_id = ${scope.orgId}
              AND business_profile_id = ${scope.businessProfileId} FOR UPDATE`));
        if (!invoice) return { kind: 'not_found' };
        if (row.matched_receipt_id || (row.matched_invoice_id && row.matched_invoice_id !== input.invoiceId)) return { kind: 'conflict' };
        const amountCents = Number(row.amount_cents);
        if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || row.duplicate_of_txn_id) return { kind: 'invalid' };
        const amount = amountCents / 100;
        const totalAmount = Number(invoice.total_amount);
        const originalPaidCents = Math.round(Number(invoice.paid_amount ?? 0) * 100);
        if (!Number.isFinite(totalAmount) || totalAmount <= 0 || !Number.isSafeInteger(Math.round(totalAmount * 100))
            || !Number.isSafeInteger(originalPaidCents) || originalPaidCents < 0) return { kind: 'invalid' };
        const result = (kind: 'applied' | 'replayed', status = invoice.status, paid = Number(invoice.paid_amount) || 0, writeOffAmount = 0): InvoiceMatchMutationResult =>
            ({ kind, paymentId, invoiceStatus: status, invoicePaidAmount: paid, amount, totalAmount, writeOffAmount });
        const [payment] = rows(await tx.execute(sql`SELECT * FROM invoice_payments WHERE payment_id = ${paymentId} FOR UPDATE`));
        if (payment && (payment.org_id !== scope.orgId || payment.business_profile_id !== scope.businessProfileId
            || payment.invoice_id !== input.invoiceId || payment.user_id !== input.userId
            || payment.method !== 'BANK_TRANSFER' || Math.round(Number(payment.amount) * 100) !== amountCents)) return { kind: 'conflict' };
        const linked = row.matched_invoice_id === input.invoiceId;
        // A link without the exact scoped payment, or an orphan payment, is
        // ambiguous legacy/inconsistent state. Neither gets counted or deleted.
        if (linked !== !!payment) return { kind: 'conflict' };
        if (input.action === 'accept') {
            if (linked) return result('replayed');
            if (invoice.status === 'VOID' || invoice.is_quote || invoice.is_payment_link) return { kind: 'invalid' };
            const paidCents = Math.round(Number(invoice.paid_amount ?? 0) * 100) + amountCents;
            const totalCents = Math.round(totalAmount * 100);
            const remainder = totalCents - paidCents;
            const writeOff = input.writeOffRemainder === true && remainder > 0 && remainder <= totalCents * 0.02;
            const status = paidCents >= totalCents || writeOff ? 'PAID' : 'PARTIAL';
            const inserted = rows(await tx.execute(sql`INSERT INTO invoice_payments
                (payment_id, invoice_id, org_id, business_profile_id, user_id, amount, method, paid_date, note)
                VALUES (${paymentId}, ${input.invoiceId}, ${scope.orgId}, ${scope.businessProfileId}, ${input.userId},
                    ${String(amount)}, 'BANK_TRANSFER', ${row.txn_date instanceof Date ? row.txn_date.toISOString().slice(0, 10) : row.txn_date ? String(row.txn_date).slice(0, 10) : new Date().toISOString().slice(0, 10)},
                    ${`Matched to ${input.source} transaction ${input.txnId}`})
                ON CONFLICT DO NOTHING RETURNING payment_id`));
            // An unexpected conflicting writer must roll back the whole unit.
            if (inserted.length !== 1) throw new Error('Invoice match payment conflict');
            const invoiceUpdated = rows(await tx.execute(sql`UPDATE invoices SET paid_amount = ${String(paidCents / 100)}, status = ${status}, updated_at = now()
                WHERE invoice_id = ${input.invoiceId} AND org_id = ${scope.orgId} AND business_profile_id = ${scope.businessProfileId} RETURNING invoice_id`));
            if (invoiceUpdated.length !== 1) throw new Error('Invoice match balance conflict');
            const stamped = rows(await tx.execute(sql`UPDATE ${child} SET matched_invoice_id = ${input.invoiceId},
                match_source = ${input.matchSource ?? 'USER'}, updated_at = now()
                WHERE txn_id = ${input.txnId} AND user_id = ${input.userId} AND matched_invoice_id IS NULL AND matched_receipt_id IS NULL
                RETURNING txn_id`));
            if (stamped.length !== 1) throw new Error('Invoice match stamp conflict');
            return result('applied', status, paidCents / 100, writeOff ? remainder / 100 : 0);
        }
        if (!linked) return result('replayed');
        // Preserve any independently recorded invoice balance; reverse exactly
        // this proven payment rather than summing unassigned payment records.
        const paidCents = Math.round(Number(invoice.paid_amount ?? 0) * 100) - amountCents;
        if (paidCents < 0 || invoice.status === 'VOID') return { kind: 'conflict' };
        const today = new Date().toISOString().slice(0, 10);
        const status = paidCents >= Math.round(totalAmount * 100) && totalAmount > 0 ? 'PAID'
            : paidCents > 0 ? 'PARTIAL' : invoice.due_date && String(invoice.due_date) < today ? 'OVERDUE' : 'SENT';
        const deleted = rows(await tx.execute(sql`DELETE FROM invoice_payments WHERE payment_id = ${paymentId}
            AND invoice_id = ${input.invoiceId} AND org_id = ${scope.orgId} AND business_profile_id = ${scope.businessProfileId} RETURNING payment_id`));
        if (deleted.length !== 1) throw new Error('Invoice match payment deletion conflict');
        const invoiceUpdated = rows(await tx.execute(sql`UPDATE invoices SET paid_amount = ${String(paidCents / 100)}, status = ${status}, updated_at = now()
            WHERE invoice_id = ${input.invoiceId} AND org_id = ${scope.orgId} AND business_profile_id = ${scope.businessProfileId} RETURNING invoice_id`));
        if (invoiceUpdated.length !== 1) throw new Error('Invoice match reversal balance conflict');
        const cleared = rows(await tx.execute(sql`UPDATE ${child} SET matched_invoice_id = NULL, match_source = NULL, updated_at = now()
            WHERE txn_id = ${input.txnId} AND user_id = ${input.userId} AND matched_invoice_id = ${input.invoiceId}
            RETURNING txn_id`));
        if (cleared.length !== 1) throw new Error('Invoice match reversal conflict');
        await tx.execute(sql`INSERT INTO match_rejections (txn_id, target_type, target_id, user_id, rejected_by)
            VALUES (${input.txnId}, 'INVOICE', ${input.invoiceId}, ${input.userId}, ${input.userId}) ON CONFLICT DO NOTHING`);
        return result('applied', status, paidCents / 100);
    });
}
