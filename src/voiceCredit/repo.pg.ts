import { and, eq, sql, desc, like } from 'drizzle-orm';
import { getPg, getPgTx, type PgDb } from '../pg/client';
import { voiceCreditWallets, voiceCreditLedger } from '../pg/schema/voiceCredit';
import {
    VoiceCreditLedgerEntry, WALLET_BALANCE_SK, WALLET_LEDGER_PREFIX,
    topupLedgerSk, callLedgerSk, grantLedgerSk,
} from './schema';
import type { IVoiceCreditRepo } from './repo';

function ledgerToDto(row: any): VoiceCreditLedgerEntry {
    const dto: any = { orgId: row.orgId, sk: row.entryId };
    for (const k of ['type', 'amountCents', 'callId', 'stripeSessionId', 'period', 'description', 'createdAt']) {
        if (row[k] != null) dto[k] = row[k];
    }
    return dto as VoiceCreditLedgerEntry;
}

export class VoiceCreditPgRepo implements IVoiceCreditRepo {
    constructor(private injected?: PgDb, private injectedTx?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }
    private get tx(): PgDb { return this.injectedTx ?? this.injected ?? getPgTx(); }

    async getBalance(orgId: string): Promise<number> {
        const r = await this.db.select({ b: voiceCreditWallets.balanceCents }).from(voiceCreditWallets).where(eq(voiceCreditWallets.orgId, orgId)).limit(1);
        return r[0]?.b ?? 0;
    }

    /** Atomic ledger-insert + balance-increment; idempotent on the deterministic entry_id. */
    private async apply(orgId: string, entryId: string, delta: number, fields: Record<string, any>): Promise<number> {
        const now = new Date().toISOString();
        await (this.tx as any).transaction(async (tx: any) => {
            const ins = await tx.insert(voiceCreditLedger)
                .values({ orgId, entryId, createdAt: now, ...fields, amountCents: delta })
                .onConflictDoNothing({ target: [voiceCreditLedger.orgId, voiceCreditLedger.entryId] })
                .returning({ e: voiceCreditLedger.entryId });
            if (ins.length === 0) return; // duplicate — no-op
            await tx.insert(voiceCreditWallets)
                .values({ orgId, balanceCents: delta, currency: 'aud', updatedAt: now })
                .onConflictDoUpdate({ target: voiceCreditWallets.orgId, set: { balanceCents: sql`${voiceCreditWallets.balanceCents} + ${delta}`, currency: sql`coalesce(${voiceCreditWallets.currency}, 'aud')`, updatedAt: now } });
        });
        return this.getBalance(orgId);
    }

    async credit(orgId: string, amountCents: number, meta: { stripeSessionId: string; description?: string }): Promise<number> {
        return this.apply(orgId, topupLedgerSk(meta.stripeSessionId), amountCents, { type: 'topup', stripeSessionId: meta.stripeSessionId, description: meta.description ?? null });
    }
    async debit(orgId: string, amountCents: number, meta: { callId: string; description?: string }): Promise<number> {
        if (amountCents <= 0) return this.getBalance(orgId);
        return this.apply(orgId, callLedgerSk(meta.callId), -amountCents, { type: 'debit', callId: meta.callId, description: meta.description ?? null });
    }
    async grantMonthlyAllowance(orgId: string, period: string, amountCents: number): Promise<number> {
        if (amountCents <= 0) return this.getBalance(orgId);
        return this.apply(orgId, grantLedgerSk(period), amountCents, { type: 'grant', period, description: `Included voice allowance (${period})` });
    }
    async getPeriodGrant(orgId: string, period: string): Promise<number> {
        const r = await this.db.select({ a: voiceCreditLedger.amountCents }).from(voiceCreditLedger).where(and(eq(voiceCreditLedger.orgId, orgId), eq(voiceCreditLedger.entryId, grantLedgerSk(period)))).limit(1);
        return r[0]?.a ?? 0;
    }
    async listLedger(orgId: string, limit = 10): Promise<VoiceCreditLedgerEntry[]> {
        const rows = await this.db.select().from(voiceCreditLedger)
            .where(and(eq(voiceCreditLedger.orgId, orgId), like(voiceCreditLedger.entryId, `${WALLET_LEDGER_PREFIX}%`)))
            .orderBy(desc(voiceCreditLedger.createdAt)).limit(limit);
        return rows.map(ledgerToDto);
    }

    /** Backfill/mirror: copy a Dynamo WALLET# item into pg (idempotent). */
    async upsertWalletItem(item: Record<string, any>): Promise<void> {
        if (item.sk === WALLET_BALANCE_SK) {
            const row = { orgId: item.orgId, balanceCents: item.balanceCents ?? 0, currency: item.currency ?? null, updatedAt: item.updatedAt ?? null };
            await this.db.insert(voiceCreditWallets).values(row as any).onConflictDoUpdate({ target: voiceCreditWallets.orgId, set: row as any });
        } else if (typeof item.sk === 'string' && item.sk.startsWith(WALLET_LEDGER_PREFIX)) {
            const row = { orgId: item.orgId, entryId: item.sk, type: item.type ?? null, amountCents: item.amountCents ?? null, callId: item.callId ?? null, stripeSessionId: item.stripeSessionId ?? null, period: item.period ?? null, description: item.description ?? null, createdAt: item.createdAt ?? null };
            await this.db.insert(voiceCreditLedger).values(row as any).onConflictDoUpdate({ target: [voiceCreditLedger.orgId, voiceCreditLedger.entryId], set: row as any });
        }
    }
}
