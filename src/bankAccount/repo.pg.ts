import { and, desc, eq, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { bankAccounts } from '../pg/schema/bankFeeds';
import { toRow, fromRow } from '../pg/rows';
import type { BankAccount } from './schema';

/**
 * Postgres-only repo for consented bank accounts (born in Postgres).
 *
 * `upsertAccount` is keyed on the provider's own account id so a re-sync of the
 * same consent is idempotent (idempotency §5.3 — deterministic ids). The
 * annotation-free account record is safe to overwrite wholesale on each sync.
 */
export class BankAccountPgRepo {
    constructor(private injected?: PgDb) {}

    private get db(): PgDb {
        return this.injected ?? getPg();
    }

    /** Insert or refresh one account (provider account id is the PK). */
    async upsertAccount(item: Record<string, any>): Promise<void> {
        const row = toRow(bankAccounts, item, 'bankAccount') as any;
        const { accountId, createdAt, ...rest } = row;
        const setClause: Record<string, any> = {};
        for (const key of Object.keys(rest)) {
            setClause[key] = sql.raw(`excluded.${(bankAccounts as any)[key].name}`);
        }
        await this.db.insert(bankAccounts)
            .values(row)
            .onConflictDoUpdate({
                target: bankAccounts.accountId,
                set: { ...setClause, updatedAt: new Date() } as any,
            });
    }

    async getAccount(userId: string, accountId: string): Promise<BankAccount | null> {
        const rows = await this.db.select().from(bankAccounts)
            .where(and(eq(bankAccounts.accountId, accountId), eq(bankAccounts.userId, userId)))
            .limit(1);
        return rows[0] ? fromRow<BankAccount>(rows[0]) : null;
    }

    /** All accounts for a user, newest first. Small bounded set — no pagination needed. */
    async listAccounts(userId: string): Promise<BankAccount[]> {
        const rows = await this.db.select().from(bankAccounts)
            .where(eq(bankAccounts.userId, userId))
            .orderBy(desc(bankAccounts.createdAt));
        return rows.map((r) => fromRow<BankAccount>(r));
    }

    /** Accounts tied to one consent — used when a consent is revoked/expired. */
    async listByConsent(userId: string, consentId: string): Promise<BankAccount[]> {
        const rows = await this.db.select().from(bankAccounts)
            .where(and(eq(bankAccounts.userId, userId), eq(bankAccounts.consentId, consentId)))
            .orderBy(desc(bankAccounts.createdAt));
        return rows.map((r) => fromRow<BankAccount>(r));
    }

    /** Flip every account under a consent to DISCONNECTED (disconnect path). Idempotent. */
    async disconnectByConsent(userId: string, consentId: string): Promise<number> {
        const updated = await this.db.update(bankAccounts)
            .set({ status: 'DISCONNECTED', updatedAt: new Date() } as any)
            .where(and(eq(bankAccounts.userId, userId), eq(bankAccounts.consentId, consentId)))
            .returning({ accountId: bankAccounts.accountId });
        return updated.length;
    }
}
