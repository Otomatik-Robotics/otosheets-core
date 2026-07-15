import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { statements, statementTransactions } from '../pg/schema/statements';
import { bankAccounts, bankTransactions } from '../pg/schema/bankFeeds';
import { matchRejections } from '../pg/schema/ledgerMatch';
import { invoices, invoicePayments, clients } from '../pg/schema/billingCore';
import { receipts } from '../pg/schema/opsEntities';
import type {
    MatchableLedgerRow, OpenInvoiceForMatching, UnlinkedReceiptForMatching,
    MatchRejectionRow, MatchSource, MatchTargetType, UnmatchedIncomeRow,
    InvoiceDepositCheck,
} from './schema';

/** Dollars-NUMERIC → integer cents (invoices/receipts store dollars; bank rows store cents). */
const toCents = (v: unknown): number => Math.round(Number(v ?? 0) * 100);

const ROW_CAP = 2000;       // statements top out in the hundreds of rows
const CANDIDATE_CAP = 1000; // open invoices / unlinked receipts per org

/**
 * Postgres-only repo for bank ↔ ledger matching (statement reconciliation
 * step 6). Like ClientOverviewPgRepo, there is no Dynamo implementation by
 * design: matching joins bank money (born in Postgres) against billing-core
 * and ops (Postgres-authoritative), and it reads Postgres regardless of the
 * cutover flag. The two write paths — stamping an accepted link, remembering
 * a rejection — are conditional/ON CONFLICT DO NOTHING, so both are safe to
 * run twice (idempotency §5).
 */
export class LedgerMatchPgRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    /** Every row of one statement, engine-shaped. Bounded: statements are finite. */
    async listStatementRowsForMatching(userId: string, statementId: string): Promise<MatchableLedgerRow[]> {
        const rows = await this.db.select({
            txnId: statementTransactions.txnId,
            statementId: statementTransactions.statementId,
            seq: statementTransactions.seq,
            txnDate: statementTransactions.txnDate,
            description: statementTransactions.description,
            amountCents: statementTransactions.amountCents,
            direction: statementTransactions.direction,
            flowClass: statementTransactions.flowClass,
            duplicateOfTxnId: statementTransactions.duplicateOfTxnId,
            transferPairId: statementTransactions.transferPairId,
            matchedInvoiceId: statementTransactions.matchedInvoiceId,
            matchedReceiptId: statementTransactions.matchedReceiptId,
        })
            .from(statementTransactions)
            .where(and(
                eq(statementTransactions.statementId, statementId),
                eq(statementTransactions.userId, userId),
            ))
            .orderBy(sql`${statementTransactions.seq} ASC`)
            .limit(ROW_CAP);
        return rows.map((r) => ({
            txnId: r.txnId,
            source: 'statement' as const,
            statementId: r.statementId,
            accountId: null,
            seq: r.seq,
            txnDate: (r.txnDate as string | null) ?? null,
            description: r.description ?? null,
            amountCents: Number(r.amountCents),
            direction: (r.direction as 'DEBIT' | 'CREDIT' | null) ?? null,
            flowClass: r.flowClass ?? null,
            duplicateOfTxnId: r.duplicateOfTxnId ?? null,
            transferPairId: r.transferPairId ?? null,
            matchedInvoiceId: r.matchedInvoiceId ?? null,
            matchedReceiptId: r.matchedReceiptId ?? null,
        }));
    }

    /** Feed rows of one account in a date window, engine-shaped. */
    async listFeedRowsForMatching(userId: string, accountId: string, opts: {
        dateFrom: string; dateTo?: string;
    }): Promise<MatchableLedgerRow[]> {
        const conditions: any[] = [
            eq(bankTransactions.userId, userId),
            eq(bankTransactions.accountId, accountId),
            sql`${bankTransactions.txnDate} >= ${opts.dateFrom}::date`,
        ];
        if (opts.dateTo) conditions.push(sql`${bankTransactions.txnDate} <= ${opts.dateTo}::date`);
        const rows = await this.db.select({
            txnId: bankTransactions.txnId,
            accountId: bankTransactions.accountId,
            txnDate: bankTransactions.txnDate,
            description: bankTransactions.description,
            amountCents: bankTransactions.amountCents,
            direction: bankTransactions.direction,
            duplicateOfTxnId: bankTransactions.duplicateOfTxnId,
            matchedInvoiceId: bankTransactions.matchedInvoiceId,
            matchedReceiptId: bankTransactions.matchedReceiptId,
        })
            .from(bankTransactions)
            .where(and(...conditions))
            .orderBy(sql`${bankTransactions.txnDate} ASC`, sql`${bankTransactions.txnId} ASC`)
            .limit(ROW_CAP);
        return rows.map((r) => ({
            txnId: r.txnId,
            source: 'feed' as const,
            statementId: null,
            accountId: r.accountId,
            seq: null,
            txnDate: (r.txnDate as string | null) ?? null,
            description: r.description ?? null,
            amountCents: Number(r.amountCents),
            direction: (r.direction as 'DEBIT' | 'CREDIT' | null) ?? null,
            flowClass: null,
            duplicateOfTxnId: r.duplicateOfTxnId ?? null,
            transferPairId: null,
            matchedInvoiceId: r.matchedInvoiceId ?? null,
            matchedReceiptId: r.matchedReceiptId ?? null,
        }));
    }

    /** One bank-money row by id, engine-shaped (accept/reject need the current state). */
    async getRowForMatching(
        userId: string, source: 'statement' | 'feed', txnId: string,
    ): Promise<MatchableLedgerRow | null> {
        if (source === 'statement') {
            const rows = await this.db.select().from(statementTransactions)
                .where(and(eq(statementTransactions.txnId, txnId), eq(statementTransactions.userId, userId)))
                .limit(1);
            const r = rows[0];
            if (!r) return null;
            return {
                txnId: r.txnId, source: 'statement', statementId: r.statementId, accountId: null,
                seq: r.seq, txnDate: (r.txnDate as string | null) ?? null, description: r.description ?? null,
                amountCents: Number(r.amountCents), direction: (r.direction as any) ?? null,
                flowClass: r.flowClass ?? null, duplicateOfTxnId: r.duplicateOfTxnId ?? null,
                transferPairId: r.transferPairId ?? null,
                matchedInvoiceId: r.matchedInvoiceId ?? null, matchedReceiptId: r.matchedReceiptId ?? null,
            };
        }
        const rows = await this.db.select().from(bankTransactions)
            .where(and(eq(bankTransactions.txnId, txnId), eq(bankTransactions.userId, userId)))
            .limit(1);
        const r = rows[0];
        if (!r) return null;
        return {
            txnId: r.txnId, source: 'feed', statementId: null, accountId: r.accountId,
            seq: null, txnDate: (r.txnDate as string | null) ?? null, description: r.description ?? null,
            amountCents: Number(r.amountCents), direction: (r.direction as any) ?? null,
            flowClass: null, duplicateOfTxnId: r.duplicateOfTxnId ?? null, transferPairId: null,
            matchedInvoiceId: r.matchedInvoiceId ?? null, matchedReceiptId: r.matchedReceiptId ?? null,
        };
    }

    /**
     * Invoices still owed money (SENT / PARTIAL / OVERDUE, real invoices only),
     * with the client name joined live — the CREDIT candidate set. Cents.
     */
    async listOpenInvoicesForMatching(orgId: string, businessProfileId?: string | null): Promise<OpenInvoiceForMatching[]> {
        const conditions: any[] = [
            eq(invoices.orgId, orgId),
            sql`${invoices.status} IN ('SENT', 'PARTIAL', 'OVERDUE')`,
            sql`(${invoices.isQuote} IS NULL OR ${invoices.isQuote} = false)`,
            sql`(${invoices.isPaymentLink} IS NULL OR ${invoices.isPaymentLink} = false)`,
        ];
        if (businessProfileId) conditions.push(eq(invoices.businessProfileId, businessProfileId));
        const rows = await this.db.select({
            invoiceId: invoices.invoiceId,
            invoiceNumber: invoices.invoiceNumber,
            clientId: invoices.clientId,
            clientName: clients.name,
            totalAmount: invoices.totalAmount,
            paidAmount: invoices.paidAmount,
            issueDate: invoices.date,
            status: invoices.status,
        })
            .from(invoices)
            .leftJoin(clients, eq(clients.clientId, invoices.clientId))
            .where(and(...conditions))
            .limit(CANDIDATE_CAP);
        return rows.map((r) => {
            const totalCents = toCents(r.totalAmount);
            const paidCents = toCents(r.paidAmount);
            return {
                invoiceId: r.invoiceId,
                invoiceNumber: r.invoiceNumber ?? null,
                clientId: r.clientId ?? null,
                clientName: r.clientName ?? null,
                totalCents,
                paidCents,
                amountDueCents: totalCents - paidCents,
                issueDate: r.issueDate ?? null,
                status: r.status ?? 'SENT',
            };
        });
    }

    /**
     * Receipts in a date window that no bank row (either source) links to yet —
     * the DEBIT candidate set. Cents.
     */
    async listUnlinkedReceipts(orgId: string, opts: { dateFrom: string; dateTo: string }): Promise<UnlinkedReceiptForMatching[]> {
        const rows = await this.db.select({
            receiptId: receipts.receiptId,
            vendorName: receipts.vendorName,
            totalAmount: receipts.totalAmount,
            receiptDate: receipts.date,
        })
            .from(receipts)
            .where(and(
                eq(receipts.orgId, orgId),
                isNull(receipts.duplicateOf),
                sql`${receipts.date} >= ${opts.dateFrom}`,
                sql`${receipts.date} <= ${opts.dateTo}`,
                sql`${receipts.totalAmount} IS NOT NULL AND ${receipts.totalAmount} > 0`,
                sql`NOT EXISTS (SELECT 1 FROM statement_transactions st WHERE st.matched_receipt_id = ${receipts.receiptId})`,
                sql`NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.matched_receipt_id = ${receipts.receiptId})`,
            ))
            .limit(CANDIDATE_CAP);
        return rows.map((r) => ({
            receiptId: r.receiptId,
            vendorName: r.vendorName ?? null,
            totalCents: toCents(r.totalAmount),
            receiptDate: r.receiptDate ?? null,
        }));
    }

    /** Rejection memory for a set of bank rows (chunked IN). */
    async listRejections(userId: string, txnIds: string[]): Promise<MatchRejectionRow[]> {
        const out: MatchRejectionRow[] = [];
        const CHUNK = 500;
        for (let i = 0; i < txnIds.length; i += CHUNK) {
            const rows = await this.db.select({
                txnId: matchRejections.txnId,
                targetType: matchRejections.targetType,
                targetId: matchRejections.targetId,
            })
                .from(matchRejections)
                .where(and(
                    eq(matchRejections.userId, userId),
                    inArray(matchRejections.txnId, txnIds.slice(i, i + CHUNK)),
                ));
            out.push(...rows.map((r) => ({
                txnId: r.txnId,
                targetType: r.targetType as MatchTargetType,
                targetId: r.targetId,
            })));
        }
        return out;
    }

    /** Remember a dismissal — ON CONFLICT DO NOTHING, safe to run twice. */
    async rejectMatch(
        userId: string, txnId: string, targetType: MatchTargetType, targetId: string, rejectedBy?: string,
    ): Promise<void> {
        await this.db.insert(matchRejections)
            .values({ userId, txnId, targetType, targetId, rejectedBy: rejectedBy ?? userId })
            .onConflictDoNothing();
    }

    /**
     * Stamp an accepted link onto the bank row — conditional so it is safe to
     * run twice and can never silently repoint an existing link:
     * the write only lands when the target column is NULL or already equal.
     * Returns 'linked' (fresh or replay), 'conflict' (row linked elsewhere),
     * or 'not_found'.
     */
    async stampMatch(
        userId: string,
        source: 'statement' | 'feed',
        txnId: string,
        target: { type: MatchTargetType; id: string },
        matchSource: MatchSource,
    ): Promise<'linked' | 'conflict' | 'not_found'> {
        const table = source === 'statement' ? sql.raw('statement_transactions') : sql.raw('bank_transactions');
        const column = target.type === 'INVOICE' ? sql.raw('matched_invoice_id') : sql.raw('matched_receipt_id');
        const result: any = await this.db.execute(sql`
            UPDATE ${table} SET
                ${column} = ${target.id},
                match_source = ${matchSource},
                updated_at = now()
            WHERE txn_id = ${txnId} AND user_id = ${userId}
              AND (${column} IS NULL OR ${column} = ${target.id})
            RETURNING txn_id
        `);
        const rows = result.rows ?? result;
        if (rows && rows.length > 0) return 'linked';
        const existing = await this.getRowForMatching(userId, source, txnId);
        return existing ? 'conflict' : 'not_found';
    }

    /**
     * Confirmed old credits no invoice explains — transfers, refunds,
     * duplicates and already-matched rows excluded; statement and feed rows
     * UNIONed with a display label for the account the money landed in.
     * `olderThan` is a YYYY-MM-DD cutoff supplied by the caller.
     */
    async listUnmatchedIncome(userId: string, opts: { olderThan: string; limit?: number }): Promise<UnmatchedIncomeRow[]> {
        const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
        const result: any = await this.db.execute(sql`
            SELECT * FROM (
                SELECT
                    st.txn_id            AS txn_id,
                    'statement'          AS source,
                    st.statement_id      AS statement_id,
                    st.seq               AS seq,
                    NULL                 AS account_id,
                    st.txn_date::text    AS txn_date,
                    st.description       AS description,
                    st.amount_cents      AS amount_cents,
                    NULLIF(TRIM(CONCAT(COALESCE(s.bank_name, ''),
                        CASE WHEN s.account_last4 IS NOT NULL THEN CONCAT(' •• ', s.account_last4) ELSE '' END)), '')
                                         AS account_label
                FROM statement_transactions st
                JOIN statements s ON s.statement_id = st.statement_id
                WHERE st.user_id = ${userId}
                  AND st.amount_cents > 0
                  AND (st.direction IS NULL OR st.direction = 'CREDIT')
                  AND (st.flow_class IS NULL OR st.flow_class = 'INCOME')
                  AND st.duplicate_of_txn_id IS NULL
                  AND st.transfer_pair_id IS NULL
                  AND st.matched_invoice_id IS NULL
                  AND st.txn_date IS NOT NULL AND st.txn_date <= ${opts.olderThan}::date
                UNION ALL
                SELECT
                    bt.txn_id            AS txn_id,
                    'feed'               AS source,
                    NULL                 AS statement_id,
                    NULL                 AS seq,
                    bt.account_id        AS account_id,
                    bt.txn_date::text    AS txn_date,
                    bt.description       AS description,
                    bt.amount_cents      AS amount_cents,
                    NULLIF(TRIM(CONCAT(COALESCE(ba.institution_name, ba.name, ''),
                        CASE WHEN ba.account_number_masked IS NOT NULL THEN CONCAT(' •• ', RIGHT(ba.account_number_masked, 4)) ELSE '' END)), '')
                                         AS account_label
                FROM bank_transactions bt
                JOIN bank_accounts ba ON ba.account_id = bt.account_id
                WHERE bt.user_id = ${userId}
                  AND bt.amount_cents > 0
                  AND (bt.direction IS NULL OR bt.direction = 'CREDIT')
                  AND bt.duplicate_of_txn_id IS NULL
                  AND bt.matched_invoice_id IS NULL
                  AND bt.txn_date IS NOT NULL AND bt.txn_date <= ${opts.olderThan}::date
            ) unified
            ORDER BY txn_date ASC, txn_id ASC
            LIMIT ${limit}
        `);
        const rows: any[] = result.rows ?? result;
        return rows.map((r) => ({
            txnId: r.txn_id,
            source: r.source as 'statement' | 'feed',
            statementId: r.statement_id ?? null,
            seq: r.seq != null ? Number(r.seq) : null,
            accountId: r.account_id ?? null,
            txnDate: r.txn_date ?? null,
            description: r.description ?? null,
            amountCents: Number(r.amount_cents),
            accountLabel: r.account_label ?? null,
        }));
    }

    /**
     * Deposit evidence for a page of invoices — one query per chunk: is any
     * bank row linked to the invoice, and when was its latest BANK_TRANSFER
     * payment recorded. Feeds the "no bank deposit found" advisory.
     */
    async depositCheckForInvoices(orgId: string, invoiceIds: string[]): Promise<InvoiceDepositCheck[]> {
        if (invoiceIds.length === 0) return [];
        const out: InvoiceDepositCheck[] = [];
        const CHUNK = 200;
        for (let i = 0; i < invoiceIds.length; i += CHUNK) {
            const ids = invoiceIds.slice(i, i + CHUNK);
            const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
            const result: any = await this.db.execute(sql`
                SELECT
                    i.invoice_id,
                    (EXISTS (SELECT 1 FROM statement_transactions st WHERE st.matched_invoice_id = i.invoice_id)
                     OR EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.matched_invoice_id = i.invoice_id))
                        AS bank_matched,
                    (SELECT MAX(p.paid_date) FROM invoice_payments p
                     WHERE p.invoice_id = i.invoice_id AND p.method = 'BANK_TRANSFER')
                        AS last_bank_transfer_payment_date
                FROM invoices i
                WHERE i.org_id = ${orgId} AND i.invoice_id IN (${idList})
            `);
            const rows: any[] = result.rows ?? result;
            out.push(...rows.map((r) => ({
                invoiceId: r.invoice_id,
                bankMatched: r.bank_matched === true || r.bank_matched === 't',
                lastBankTransferPaymentDate: r.last_bank_transfer_payment_date ?? null,
            })));
        }
        return out;
    }
}

let singleton: LedgerMatchPgRepo | null = null;

/** Lazy singleton, mirroring the other pg-only reporting repos. */
export function getLedgerMatchRepo(): LedgerMatchPgRepo {
    if (!singleton) singleton = new LedgerMatchPgRepo();
    return singleton;
}
