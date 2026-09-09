import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { profilePayerAliases as aliases } from '../pg/schema/payerAliases';
import type { PayerAlias } from './schema';

export interface ProfilePayerAlias extends PayerAlias { businessProfileId: string }

/** Profile aliases never consult or rewrite the legacy organisation-only map. */
export class ProfilePayerAliasPgRepo {
    private readonly scope: Readonly<{ orgId: string; businessProfileId: string }>;
    constructor(scope: { orgId: string; businessProfileId: string }, private readonly injected?: PgDb) {
        if (!scope.orgId?.trim() || !scope.businessProfileId?.trim()) throw new Error('Payer alias scope is required');
        this.scope = Object.freeze({ orgId: scope.orgId, businessProfileId: scope.businessProfileId });
    }
    private get db() { return this.injected ?? getPg(); }
    private ownedClient(clientId: unknown) {
        return sql`EXISTS (SELECT 1 FROM clients c JOIN business_profiles p ON p.business_profile_id = c.business_profile_id
            WHERE c.client_id = ${clientId} AND c.org_id = ${this.scope.orgId}
            AND c.business_profile_id = ${this.scope.businessProfileId} AND p.org_id = ${this.scope.orgId})`;
    }
    private where() {
        return and(eq(aliases.orgId, this.scope.orgId), eq(aliases.businessProfileId, this.scope.businessProfileId), this.ownedClient(aliases.clientId));
    }
    async lookup(payerKeys: string[]): Promise<Map<string, string>> {
        const keys = [...new Set(payerKeys.map(k => k.trim()).filter(Boolean))];
        const result = new Map<string, string>();
        for (let i = 0; i < keys.length; i += 500) {
            const rows = await this.db.select({ payerKey: aliases.payerKey, clientId: aliases.clientId }).from(aliases)
                .where(and(this.where(), inArray(aliases.payerKey, keys.slice(i, i + 500))));
            for (const row of rows) result.set(row.payerKey, row.clientId);
        }
        return result;
    }
    async upsert(payerKey: string, clientId: string, createdBy?: string): Promise<boolean> {
        const key = payerKey.trim();
        if (!key || !clientId.trim()) return false;
        const result = await this.db.execute(sql`INSERT INTO profile_payer_aliases (org_id, business_profile_id, payer_key, client_id, created_by)
            SELECT ${this.scope.orgId}, ${this.scope.businessProfileId}, ${key}, ${clientId}, ${createdBy ?? null}
            WHERE ${this.ownedClient(clientId)}
            ON CONFLICT (org_id, business_profile_id, payer_key) DO UPDATE SET client_id = excluded.client_id, updated_at = now()
            RETURNING payer_key`);
        return result.rows.length === 1;
    }
    async remove(payerKey: string): Promise<void> {
        // Removing an owned key can also clear a quarantined stale client reference.
        await this.db.delete(aliases).where(and(eq(aliases.orgId, this.scope.orgId),
            eq(aliases.businessProfileId, this.scope.businessProfileId), eq(aliases.payerKey, payerKey.trim())));
    }
    private cursor(token: string): string {
        try {
            if (token.length > 8192) throw new Error();
            const bytes = Buffer.from(token, 'base64url');
            if (bytes.toString('base64url') !== token) throw new Error();
            const parts = JSON.parse(bytes.toString('utf8'));
            if (!Array.isArray(parts) || parts.length !== 3 || parts[0] !== this.scope.orgId || parts[1] !== this.scope.businessProfileId
                || typeof parts[2] !== 'string' || !parts[2].trim()) throw new Error();
            return parts[2];
        } catch { throw new Error('Invalid payer alias cursor'); }
    }
    async list(opts: { limit?: number; nextToken?: string | null } = {}): Promise<{ items: ProfilePayerAlias[]; nextToken: string | null }> {
        const limit = opts.limit ?? 20;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Payer alias limit must be between 1 and 100');
        const after = opts.nextToken ? this.cursor(opts.nextToken) : undefined;
        const rows = await this.db.select().from(aliases).where(and(this.where(), after === undefined ? undefined : gt(aliases.payerKey, after)))
            .orderBy(asc(aliases.payerKey)).limit(limit + 1);
        const items = rows.slice(0, limit).map(r => ({ orgId: r.orgId, businessProfileId: r.businessProfileId,
            payerKey: r.payerKey, clientId: r.clientId, createdBy: r.createdBy }));
        return { items, nextToken: rows.length > limit ? Buffer.from(JSON.stringify([
            this.scope.orgId, this.scope.businessProfileId, items[items.length - 1].payerKey,
        ])).toString('base64url') : null };
    }
}
