import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import type { IDdb } from '../ddbPort';
import { OrgDynamoRepo, type IOrgRepo } from './repo';
import { OrgPgRepo } from './repo.pg';
import { OrgStoredSchema } from './schema';

/**
 * Per-org studio entitlement (`enabledStudios` / `featureOverrides`) must
 * survive BOTH storage backends identically — under `dual_pg` the read comes
 * from Postgres, so a Dynamo-only field is silently inert (and `toRow()` throws
 * on write). These tests pin the round-trip and, just as importantly, that an
 * org that never configured entitlement still reads back `undefined`
 * ("not configured" ⇒ all studios), never `[]` or `null`.
 */

process.env.ORGANIZATIONS_TABLE = 'orgs-test';

/** Minimal in-memory IDdb covering OrgDynamoRepo's get/put/update surface. */
function makeStubDdb() {
    const store = new Map<string, any>();
    const ddb = {
        async getItem(_t: string, key: any) {
            return { Item: store.get(key.orgId) };
        },
        async put(_t: string, item: any) {
            // Dynamo drops undefined attributes (removeUndefinedValues) — mirror that.
            const clean = Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined));
            store.set(item.orgId, clean);
            return {};
        },
        async update(_t: string, key: any, params: any) {
            const item = store.get(key.orgId) ?? { orgId: key.orgId };
            const names: Record<string, string> = params.ExpressionAttributeNames ?? {};
            const values: Record<string, any> = params.ExpressionAttributeValues ?? {};
            for (const assignment of String(params.UpdateExpression).replace(/^SET\s+/i, '').split(',')) {
                const [lhs, rhs] = assignment.split('=').map((s) => s.trim());
                const attr = names[lhs] ?? lhs;
                if (values[rhs] !== undefined) item[attr] = values[rhs];
            }
            store.set(key.orgId, item);
            return {};
        },
        async query() { return { Items: [] }; },
    };
    return { ddb: ddb as unknown as IDdb, store };
}

let pgRepo: OrgPgRepo;

beforeAll(async () => {
    const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = {
        exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }),
    };
    const ran = await runMigrations(executor);
    expect(ran).toContain('0035_org_studio_entitlement.sql');
    pgRepo = new OrgPgRepo(drizzle(pglite) as unknown as PgDb);
});

const ENTITLEMENT = {
    enabledStudios: ['ops.money', 'ledger'],
    featureOverrides: { accountantPortal: true, adStudio: false },
};

describe('org studio entitlement — stored schema', () => {
    it('accepts the entitlement fields and treats them as optional', () => {
        const parsed = OrgStoredSchema.parse({
            orgId: 'o', name: 'Acme', createdAt: 'x', updatedAt: 'y', ...ENTITLEMENT,
        });
        expect(parsed.enabledStudios).toEqual(['ops.money', 'ledger']);
        expect(parsed.featureOverrides).toEqual({ accountantPortal: true, adStudio: false });

        const bare = OrgStoredSchema.parse({ orgId: 'o', name: 'Acme', createdAt: 'x', updatedAt: 'y' });
        expect(bare.enabledStudios).toBeUndefined();
        expect(bare.featureOverrides).toBeUndefined();
    });
});

describe.each([
    ['OrgDynamoRepo', (): IOrgRepo => new OrgDynamoRepo(makeStubDdb().ddb)],
    ['OrgPgRepo', (): IOrgRepo => pgRepo],
])('%s — entitlement round-trip', (_name, make) => {
    it('persists enabledStudios + featureOverrides on create', async () => {
        const repo = make();
        await repo.createOrg('org_ent_create', { name: 'Entitled Co', ...ENTITLEMENT });
        const org = await repo.getOrg('org_ent_create');
        expect(org!.enabledStudios).toEqual(['ops.money', 'ledger']);
        expect(org!.featureOverrides).toEqual({ accountantPortal: true, adStudio: false });
    });

    it('persists them on update (the path that used to throw on the pg side)', async () => {
        const repo = make();
        await repo.createOrg('org_ent_update', { name: 'Plain Co' });
        await repo.updateOrg('org_ent_update', ENTITLEMENT);
        const org = await repo.getOrg('org_ent_update');
        expect(org!.enabledStudios).toEqual(['ops.money', 'ledger']);
        expect(org!.featureOverrides).toEqual({ accountantPortal: true, adStudio: false });
    });

    it('an org that never configured entitlement reads back undefined, not [] or null', async () => {
        const repo = make();
        await repo.createOrg('org_ent_absent', { name: 'Unconfigured Co' });
        const org = await repo.getOrg('org_ent_absent');
        expect(org!.enabledStudios).toBeUndefined();
        expect(org!.featureOverrides).toBeUndefined();
        // The guard consumers actually write — absence must be falsy, so the
        // ability engine falls through to "all studios entitled".
        expect(Boolean((org as any).enabledStudios)).toBe(false);
    });

    it('mirror upsert carries entitlement through (dual-write path)', async () => {
        const repo = make();
        const now = new Date().toISOString();
        await repo.upsertOrg({
            orgId: 'org_ent_mirror', name: 'Mirrored Co',
            currency: 'AUD', gstRegistered: false, subscriptionTier: 'free', seatLimit: 0,
            createdAt: now, updatedAt: now, ...ENTITLEMENT,
        } as any);
        const org = await repo.getOrg('org_ent_mirror');
        expect(org!.enabledStudios).toEqual(['ops.money', 'ledger']);
        expect(org!.featureOverrides).toEqual({ accountantPortal: true, adStudio: false });
    });
});
