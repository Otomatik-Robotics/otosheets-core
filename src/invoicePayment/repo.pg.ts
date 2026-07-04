import { and, eq, sql } from 'drizzle-orm';
import { getPg, getPgTx, type PgDb } from '../pg/client';
import { invoicePayments, invoices } from '../pg/schema/billingCore';
import { invoicePaymentSk } from '../keys';
import { InvoicePayment } from './schema';
import type { IInvoicePaymentRepo } from './repo';

const NUMERIC_KEYS = ['amount'];

/** Reconstructs the Dynamo storage field `sk` (= invoiceId#paymentId) for DTO parity. */
function toPaymentDto(row: any): InvoicePayment {
    const dto: any = {};
    for (const [k, v] of Object.entries(row)) {
        if (v === null) continue;
        if (v instanceof Date) dto[k] = v.toISOString();
        else if (NUMERIC_KEYS.includes(k) && typeof v === 'string') dto[k] = Number(v);
        else dto[k] = v;
    }
    dto.sk = invoicePaymentSk(row.invoiceId, row.paymentId);
    return dto as InvoicePayment;
}

function toPaymentRow(p: Record<string, any>): Record<string, any> {
    // Strip the Dynamo-only sort key; columns are named to match DTO keys.
    const { sk, ...rest } = p;
    const row: Record<string, any> = {};
    for (const [k, v] of Object.entries(rest)) {
        if (v === undefined) continue;
        if (v === null) { row[k] = null; }
        else if (k === 'createdAt' && typeof v === 'string') row[k] = new Date(v); // timestamptz
        else if (NUMERIC_KEYS.includes(k) && typeof v === 'number') row[k] = String(v);
        else row[k] = v;
    }
    return row;
}

export class InvoicePaymentPgRepo implements IInvoicePaymentRepo {
    constructor(private injected?: PgDb, private injectedTx?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }
    private get tx(): PgDb { return this.injectedTx ?? this.injected ?? getPgTx(); }

    async listPayments(orgId: string, invoiceId: string): Promise<InvoicePayment[]> {
        const rows = await this.db.select().from(invoicePayments)
            .where(and(eq(invoicePayments.orgId, orgId), eq(invoicePayments.invoiceId, invoiceId)));
        return rows.map(toPaymentDto);
    }

    /**
     * Atomic: record the payment and roll the invoice's paidAmount/status in one
     * transaction (mirrors the Dynamo transactWrite). Idempotent on payment_id —
     * a replay inserts nothing and leaves the invoice untouched.
     */
    async recordPayment(
        orgId: string, invoiceId: string, invoiceUserId: string, paymentId: string,
        payment: Record<string, any>, newPaidAmount: number, newStatus: string,
    ): Promise<void> {
        const now = new Date();
        const row = { ...toPaymentRow(payment), paymentId, invoiceId, orgId, userId: payment.userId ?? invoiceUserId, createdAt: now };
        await (this.tx as any).transaction(async (tx: any) => {
            const inserted = await tx.insert(invoicePayments).values(row)
                .onConflictDoNothing({ target: invoicePayments.paymentId }).returning({ id: invoicePayments.paymentId });
            if (inserted.length === 0) return; // replay — payment already recorded
            await tx.update(invoices)
                .set({ paidAmount: String(newPaidAmount), status: newStatus, updatedAt: now })
                .where(and(eq(invoices.orgId, orgId), eq(invoices.invoiceId, invoiceId)));
        });
    }

    async upsertPayment(payment: InvoicePayment): Promise<void> {
        const row = toPaymentRow(payment as Record<string, any>);
        await this.db.insert(invoicePayments).values(row as any)
            .onConflictDoUpdate({ target: invoicePayments.paymentId, set: row as any });
    }

    async deletePayment(_orgId: string, _invoiceId: string, paymentId: string): Promise<void> {
        await this.db.delete(invoicePayments).where(eq(invoicePayments.paymentId, paymentId));
    }
}
