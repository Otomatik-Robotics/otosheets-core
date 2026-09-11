import { and, desc, eq, getTableColumns, lt, or, sql, type SQL } from 'drizzle-orm';
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
    constructor(private injected?: PgDb, private readonly scope?: Readonly<{ orgId: string; businessProfileId: string }>) {}

    withScope(orgId: string, businessProfileId: string): BankAccountPgRepo {
        if (!orgId.trim() || !businessProfileId.trim()) throw new Error('Bank account scope is required');
        if (this.scope && (orgId !== this.scope.orgId || businessProfileId !== this.scope.businessProfileId)) throw new Error('Bank account scope mismatch');
        return new BankAccountPgRepo(this.injected, Object.freeze({ orgId, businessProfileId }));
    }
    private within(...conditions: (SQL | undefined)[]) {
        return and(...conditions, ...(this.scope ? [eq(bankAccounts.organizationId, this.scope.orgId), eq(bankAccounts.businessProfileId, this.scope.businessProfileId)] : []));
    }
    private owned(item: Record<string, any>) {
        if (!this.scope) return item;
        if ((item.organizationId !== undefined && item.organizationId !== this.scope.orgId) || (item.businessProfileId !== undefined && item.businessProfileId !== this.scope.businessProfileId)) throw new Error('Bank account scope mismatch');
        return { ...item, organizationId: this.scope.orgId, businessProfileId: this.scope.businessProfileId };
    }

    private get db(): PgDb {
        return this.injected ?? getPg();
    }

    /** Insert or refresh one account (provider account id is the PK). */
    async upsertAccount(item: Record<string, any>): Promise<void> {
        const row = toRow(bankAccounts, this.owned(item), 'bankAccount') as any;
        const { accountId, createdAt, ...rest } = row;
        const setClause: Record<string, any> = {};
        for (const key of Object.keys(rest)) {
            setClause[key] = sql.raw(`excluded.${(bankAccounts as any)[key].name}`);
        }
        const updated = await this.db.insert(bankAccounts)
            .values(row)
            .onConflictDoUpdate({
                target: bankAccounts.accountId,
                set: { ...setClause, updatedAt: new Date() } as any,
                setWhere: this.within(eq(bankAccounts.userId, item.userId)),
            }).returning({ accountId: bankAccounts.accountId });
        if (!updated.length) throw new Error('Bank account ownership conflict');
    }

    async getAccount(userId: string, accountId: string): Promise<BankAccount | null> {
        const rows = await this.db.select().from(bankAccounts)
            .where(this.within(eq(bankAccounts.accountId, accountId), eq(bankAccounts.userId, userId)))
            .limit(1);
        return rows[0] ? fromRow<BankAccount>(rows[0]) : null;
    }

    /** All accounts for a user, newest first. Small bounded set — no pagination needed. */
    async listAccounts(userId: string): Promise<BankAccount[]> {
        const rows = await this.db.select().from(bankAccounts)
            .where(this.within(eq(bankAccounts.userId, userId)))
            .orderBy(desc(bankAccounts.createdAt));
        return rows.map((r) => fromRow<BankAccount>(r));
    }

    /** Profile/user-bound keyset pagination for HTTP account lists. */
    async listAccountsPage(userId: string, opts: { limit?: number; nextToken?: string | null } = {}): Promise<{ items: BankAccount[]; nextToken: string | null }> {
        if (!this.scope) throw new Error('Bank account scope is required');
        const limit = opts.limit ?? 20;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Bank account limit must be between 1 and 100');
        let after: { createdAt: string; accountId: string } | undefined;
        if (opts.nextToken) {
            try {
                if (opts.nextToken.length > 8192) throw new Error();
                const bytes = Buffer.from(opts.nextToken, 'base64url');
                if (bytes.toString('base64url') !== opts.nextToken) throw new Error();
                const parts = JSON.parse(bytes.toString('utf8'));
                if (!Array.isArray(parts) || parts.length !== 5 || parts[0] !== this.scope.orgId || parts[1] !== this.scope.businessProfileId
                    || parts[2] !== userId || typeof parts[3] !== 'string' || typeof parts[4] !== 'string' || !parts[4]) throw new Error();
                const createdAt = new Date(parts[3]);
                if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(parts[3]) || !Number.isFinite(createdAt.getTime())
                    || createdAt.toISOString().slice(0, 19) !== parts[3].slice(0, 19)) throw new Error();
                after = { createdAt: parts[3], accountId: parts[4] };
            } catch { throw new Error('Invalid bank account cursor'); }
        }
        const rows = await this.db.select({ ...getTableColumns(bankAccounts), cursorTime: sql<string>`to_char(${bankAccounts.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` })
            .from(bankAccounts).where(this.within(eq(bankAccounts.userId, userId),
            after ? or(lt(bankAccounts.createdAt, sql`${after.createdAt}::timestamptz`), and(eq(bankAccounts.createdAt, sql`${after.createdAt}::timestamptz`), lt(bankAccounts.accountId, after.accountId))) : undefined))
            .orderBy(desc(bankAccounts.createdAt), desc(bankAccounts.accountId)).limit(limit + 1);
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        return { items: page.map(({ cursorTime: _cursorTime, ...r }) => fromRow<BankAccount>(r)), nextToken: rows.length > limit ? Buffer.from(JSON.stringify([
            this.scope.orgId, this.scope.businessProfileId, userId, last.cursorTime, last.accountId,
        ])).toString('base64url') : null };
    }

    async activeAccountCount(userId: string): Promise<number> {
        if (!this.scope) throw new Error('Bank account scope is required');
        const rows = await this.db.select({ count: sql<number>`count(*)::int` }).from(bankAccounts)
            .where(this.within(eq(bankAccounts.userId, userId), eq(bankAccounts.status, 'ACTIVE')));
        return Number(rows[0]?.count ?? 0);
    }

    /** Accounts tied to one consent — used when a consent is revoked/expired. */
    async listByConsent(userId: string, consentId: string): Promise<BankAccount[]> {
        const rows = await this.db.select().from(bankAccounts)
            .where(this.within(eq(bankAccounts.userId, userId), eq(bankAccounts.consentId, consentId)))
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
        input = this.owned(input) as typeof input;
        const identity: StatementAccountIdentity = {
            bankName: input.bankName ?? null,
            accountLast4: last4Digits(input.accountLast4),
        };
        if (!identity.accountLast4) return null;

        const existing = matchStatementAccount(await this.listAccounts(input.userId), identity);
        if (existing) return existing;

        const accountId = this.scope
            ? `${statementAccountId(input.userId, identity)}#scope#${encodeURIComponent(JSON.stringify([this.scope.orgId, this.scope.businessProfileId]))}`
            : statementAccountId(input.userId, identity);
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
            .where(this.within(eq(bankAccounts.userId, userId), eq(bankAccounts.consentId, consentId)))
            .returning({ accountId: bankAccounts.accountId });
        return updated.length;
    }
}
