import { and, eq, inArray, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { payerAliases } from '../pg/schema/payerAliases';
import type { PayerAlias } from './schema';

/**
 * Postgres-only repo for org-scoped payer → client aliases. Like
 * MerchantCategoryPgRepo / LedgerMatchPgRepo there is no Dynamo implementation
 * by design — this is a relational join entity read regardless of any cutover
 * flag.
 *
 *  - `lookup(orgId, keys)` — the read path in the statement pipeline: batch
 *    resolve payer keys → clientId for one org.
 *  - `upsert(...)` — learn a link when the user creates or links a client for a
 *    payer. Idempotent: re-linking the same pair is a no-op; re-pointing a key
 *    to a different client updates it.
 */
export class PayerAliasPgRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    /** Batch resolve payer keys → clientId for one org. Blank keys are ignored. */
    async lookup(orgId: string, payerKeys: string[]): Promise<Map<string, string>> {
        const out = new Map<string, string>();
        const keys = [...new Set(payerKeys.map((k) => (k ?? '').trim()).filter((k) => k.length > 0))];
        if (!orgId || keys.length === 0) return out;
        const CHUNK = 500;
        for (let i = 0; i < keys.length; i += CHUNK) {
            const rows = await this.db.select({
                payerKey: payerAliases.payerKey,
                clientId: payerAliases.clientId,
            })
                .from(payerAliases)
                .where(and(
                    eq(payerAliases.orgId, orgId),
                    inArray(payerAliases.payerKey, keys.slice(i, i + CHUNK)),
                ));
            for (const r of rows) out.set(r.payerKey, r.clientId);
        }
        return out;
    }

    /** Learn/repoint a payer → client link. Idempotent (upsert on (org_id, payer_key)). */
    async upsert(orgId: string, payerKey: string, clientId: string, createdBy?: string | null): Promise<void> {
        const key = (payerKey ?? '').trim();
        if (!orgId || !key || !clientId) return;
        await this.db.insert(payerAliases)
            .values({ orgId, payerKey: key, clientId, createdBy: createdBy ?? null })
            .onConflictDoUpdate({
                target: [payerAliases.orgId, payerAliases.payerKey],
                set: { clientId, updatedAt: sql`now()` },
            });
    }

    /** All aliases for an org (for management / listing which descriptors map to a client). */
    async listByOrg(orgId: string): Promise<PayerAlias[]> {
        const rows = await this.db.select().from(payerAliases).where(eq(payerAliases.orgId, orgId));
        return rows.map((r) => ({
            orgId: r.orgId, payerKey: r.payerKey, clientId: r.clientId, createdBy: r.createdBy ?? null,
        }));
    }

    /** Forget a payer link. */
    async remove(orgId: string, payerKey: string): Promise<void> {
        await this.db.delete(payerAliases)
            .where(and(eq(payerAliases.orgId, orgId), eq(payerAliases.payerKey, (payerKey ?? '').trim())));
    }
}
