import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { clients } from '../pg/schema/billingCore';
import { PayerAliasPgRepo } from './repo.pg';
import { ClientPgRepo } from '../client/repo.pg';

let db: PgDb;
let repo: PayerAliasPgRepo;
let clientRepo: ClientPgRepo;

const D = (s: string) => new Date(s);
const ORG = 'org_1';
const USER = 'u_1';

beforeAll(async () => {
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    repo = new PayerAliasPgRepo(db);
    clientRepo = new ClientPgRepo(db);

    await pglite.query(`INSERT INTO orgs (org_id, name) VALUES ('${ORG}', 'Acme')`);
    await db.insert(clients).values([
        { clientId: 'c_acme', orgId: ORG, createdBy: USER, name: 'Acme Building Co', createdAt: D('2026-01-01T00:00:00Z'), updatedAt: D('2026-01-01T00:00:00Z') },
        { clientId: 'c_bright', orgId: ORG, createdBy: USER, name: 'Brightside Cafe', createdAt: D('2026-01-01T00:00:00Z'), updatedAt: D('2026-01-01T00:00:00Z') },
        { clientId: 'c_arch', orgId: ORG, createdBy: USER, name: 'Old Archived Ltd', archived: true, createdAt: D('2026-01-01T00:00:00Z'), updatedAt: D('2026-01-01T00:00:00Z') },
    ]);
});

describe('PayerAliasPgRepo', () => {
    it('upserts, looks up in batch, and re-points idempotently', async () => {
        await repo.upsert(ORG, 'acme building', 'c_acme', USER);
        await repo.upsert(ORG, 'brightside', 'c_bright', USER);

        const hits = await repo.lookup(ORG, ['acme building', 'brightside', 'unknown payer']);
        expect(hits.get('acme building')).toBe('c_acme');
        expect(hits.get('brightside')).toBe('c_bright');
        expect(hits.has('unknown payer')).toBe(false);

        // Re-point a key to a different client — updates, no duplicate row.
        await repo.upsert(ORG, 'acme building', 'c_bright', USER);
        expect((await repo.lookup(ORG, ['acme building'])).get('acme building')).toBe('c_bright');

        // Scoped to the org.
        expect((await repo.lookup('other_org', ['acme building'])).size).toBe(0);
    });

    it('lists and removes aliases', async () => {
        const all = await repo.listByOrg(ORG);
        expect(all.map((a) => a.payerKey).sort()).toEqual(['acme building', 'brightside']);
        await repo.remove(ORG, 'brightside');
        expect((await repo.lookup(ORG, ['brightside'])).size).toBe(0);
    });

    it('blank keys/orgs are inert', async () => {
        await repo.upsert(ORG, '   ', 'c_acme');
        await repo.upsert('', 'x', 'c_acme');
        expect((await repo.lookup(ORG, ['', '   '])).size).toBe(0);
    });
});

describe('ClientPgRepo.findSimilarClients', () => {
    it('finds fuzzy name matches, best first, excluding archived', async () => {
        const hits = await clientRepo.findSimilarClients(ORG, 'Acme Building');
        expect(hits[0].clientId).toBe('c_acme');
        expect(hits[0].similarity).toBeGreaterThan(0.3);
        // Archived client never surfaces.
        expect(hits.some((h) => h.clientId === 'c_arch')).toBe(false);
    });

    it('returns nothing for a payer that resembles no client', async () => {
        expect(await clientRepo.findSimilarClients(ORG, 'Zzxqwerty Holdings')).toHaveLength(0);
        expect(await clientRepo.findSimilarClients(ORG, '')).toHaveLength(0);
    });
});
