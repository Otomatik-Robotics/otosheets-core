import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { dataBackend } from '../dataBackend';
import { getPgTx, type PgDb } from '../pg/client';

export interface CreatePayerClientInput {
    payerKey: string; createdBy: string; name: string; isCompany: boolean;
    email?: string | null; phone?: string | null; abn?: string | null;
}
export type CreatePayerClientResult = { kind: 'not_found' | 'conflict' } | {
    kind: 'created' | 'replayed'; clientId: string;
    client: { clientId: string; orgId: string; businessProfileId: string; createdBy: string; name: string;
        isCompany: boolean; email: string | null; phone: string | null; abn: string | null; createdAt: string };
};
class AliasConflict extends Error {}

/** Client and alias are one PG unit; other billing stores cannot uphold this contract. */
export async function createScopedPayerClient(scope: Readonly<{ orgId: string; businessProfileId: string }>, input: CreatePayerClientInput,
    injected?: PgDb): Promise<CreatePayerClientResult> {
    if (!scope.orgId?.trim() || !scope.businessProfileId?.trim()) throw new Error('Payer alias scope is required');
    if (await dataBackend('billing-core') !== 'pg') throw new Error('Atomic payer client creation requires billing-core pg');
    const nullable = (value: string | null | undefined) => {
        if (value == null) return null;
        if (typeof value !== 'string') throw new Error('Invalid payer client input');
        return value.trim() || null;
    };
    const payerKey = nullable(input.payerKey); const name = nullable(input.name); const createdBy = nullable(input.createdBy);
    if (!payerKey || !name || !createdBy || typeof input.isCompany !== 'boolean') throw new Error('Invalid payer client input');
    const email = input.isCompany ? null : nullable(input.email)?.toLowerCase() ?? null;
    const phone = nullable(input.phone); const abn = nullable(input.abn);
    // Same authorised request retries the same client; changed input conflicts with an existing alias.
    const clientId = `payer-client-v1-${createHash('sha256').update(JSON.stringify([
        scope.orgId, scope.businessProfileId, payerKey, createdBy, name, input.isCompany, email, phone, abn,
    ])).digest('hex')}`;
    const result = (kind: 'created' | 'replayed', createdAt: unknown): CreatePayerClientResult => ({ kind, clientId,
        client: { clientId, ...scope, createdBy, name, isCompany: input.isCompany, email, phone, abn,
            createdAt: new Date(createdAt as string).toISOString() } });
    try {
        return await (injected ?? getPgTx()).transaction(async tx => {
            // Serialise this creation path per profile; no lock or authority comes from a UI default.
            const profile = await tx.execute(sql`SELECT business_profile_id FROM business_profiles
                WHERE org_id = ${scope.orgId} AND business_profile_id = ${scope.businessProfileId} FOR UPDATE`);
            if (!profile.rows.length) return { kind: 'not_found' };
            const existing = await tx.execute(sql`SELECT a.client_id, c.created_at FROM profile_payer_aliases a
                LEFT JOIN clients c ON c.client_id = a.client_id AND c.org_id = ${scope.orgId} AND c.business_profile_id = ${scope.businessProfileId}
                WHERE a.org_id = ${scope.orgId} AND a.business_profile_id = ${scope.businessProfileId} AND a.payer_key = ${payerKey}
                FOR UPDATE OF a`);
            if (existing.rows.length) {
                const row = existing.rows[0] as any;
                return row.client_id === clientId && row.created_at ? result('replayed', row.created_at) : { kind: 'conflict' };
            }
            if (email) {
                const duplicate = await tx.execute(sql`SELECT client_id FROM clients WHERE org_id = ${scope.orgId}
                    AND business_profile_id = ${scope.businessProfileId} AND email = ${email} LIMIT 1`);
                if (duplicate.rows.length) return { kind: 'conflict' };
            }
            const inserted = await tx.execute(sql`INSERT INTO clients (client_id, org_id, business_profile_id, created_by, name, is_company, email, phone, abn)
                VALUES (${clientId}, ${scope.orgId}, ${scope.businessProfileId}, ${createdBy}, ${name}, ${input.isCompany}, ${email}, ${phone}, ${abn})
                ON CONFLICT (client_id) DO NOTHING RETURNING created_at`);
            // An unlinked previous client or other existing record is never silently adopted.
            if (!inserted.rows.length) return { kind: 'conflict' };
            const alias = await tx.execute(sql`INSERT INTO profile_payer_aliases (org_id, business_profile_id, payer_key, client_id, created_by)
                VALUES (${scope.orgId}, ${scope.businessProfileId}, ${payerKey}, ${clientId}, ${createdBy})
                ON CONFLICT (org_id, business_profile_id, payer_key) DO NOTHING RETURNING client_id`);
            if (alias.rows.length !== 1) throw new AliasConflict(); // roll back the just-created client too
            return result('created', (inserted.rows[0] as any).created_at);
        });
    } catch (err) {
        if (err instanceof AliasConflict) return { kind: 'conflict' };
        throw err;
    }
}
