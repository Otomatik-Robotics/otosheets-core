import { and, desc, eq, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { bankAccounts } from '../pg/schema/bankFeeds';
import { toRow, fromRow } from '../pg/rows';
import type { BankAccount } from './schema';

/** Detected identity of a statement-derived account (both fields best-effort). */
export interface StatementAccountIdentity {
    bankName: string | null;
    accountLast4: string | null;
}

/** Last 4 digits of whatever masked/formatted number a row carries, or null. */
export function last4Digits(value: string | null | undefined): string | null {
    const digits = (value ?? '').replace(/\D/g, '');
    return digits.length >= 4 ? digits.slice(-4) : null;
}

function normalise(value: string | null | undefined): string {
    return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Deterministic id for a statement-derived account (idempotent create). */
export function statementAccountId(userId: string, identity: StatementAccountIdentity): string {
    return `stmt#${userId}#${normalise(identity.bankName) || 'unknown'}#${identity.accountLast4 ?? 'xxxx'}`;
}

/**
 * Match a detected statement account against the user's existing accounts.
 * Conservative: the last-4 must match exactly, and the institution names must
 * contain each other (normalised) when both are present. Feed (non-'statement')
 * accounts win over statement-derived ones so both ingestion sources converge
 * on the open-banking identity when it exists.
 */
export function matchStatementAccount(
    accounts: BankAccount[], identity: StatementAccountIdentity,
): BankAccount | null {
    if (!identity.accountLast4) return null;
    const bank = normalise(identity.bankName);
    const candidates = accounts.filter((a) => {
        if (a.status === 'DISCONNECTED') return false;
        if (last4Digits(a.accountNumberMasked) !== identity.accountLast4) return false;
        const institution = normalise(a.institutionName);
        // Same last-4 at an explicitly different institution is a different account.
        if (bank && institution) return institution.includes(bank) || bank.includes(institution);
        return true;
    });
    return candidates.find((a) => a.provider !== 'statement') ?? candidates[0] ?? null;
}

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

    /**
     * Resolve a statement's detected bank + last-4 to a stable account row,
     * creating a provider-'statement' account when nothing matches. A matching
     * open-banking (fiskil) account is reused, so statements and feed
     * transactions share one account identity. Idempotent: the created row's
     * id is deterministic and the insert is conflict-tolerant. Returns null
     * when the identity is too weak to key on (no last-4).
     */
    async findOrCreateStatementAccount(input: {
        userId: string;
        bankName: string | null;
        accountLast4: string | null;
        organizationId?: string | null;
        businessProfileId?: string | null;
    }): Promise<BankAccount | null> {
        const identity: StatementAccountIdentity = {
            bankName: input.bankName ?? null,
            accountLast4: last4Digits(input.accountLast4),
        };
        if (!identity.accountLast4) return null;

        const existing = matchStatementAccount(await this.listAccounts(input.userId), identity);
        if (existing) return existing;

        const accountId = statementAccountId(input.userId, identity);
        await this.db.insert(bankAccounts)
            .values(toRow(bankAccounts, {
                accountId,
                userId: input.userId,
                organizationId: input.organizationId ?? null,
                businessProfileId: input.businessProfileId ?? null,
                provider: 'statement',
                institutionName: identity.bankName,
                name: identity.bankName
                    ? `${identity.bankName} ····${identity.accountLast4}`
                    : `Account ····${identity.accountLast4}`,
                accountNumberMasked: identity.accountLast4,
                status: 'ACTIVE',
            }, 'bankAccount') as any)
            .onConflictDoNothing({ target: bankAccounts.accountId });
        return this.getAccount(input.userId, accountId);
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
