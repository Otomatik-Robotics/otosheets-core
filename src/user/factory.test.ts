import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { User } from './schema';
import type { IUserRepo } from './repo';
import { UserPgRepo } from './repo.pg';
import { RoutingUserRepo } from './factory';

/** Minimal in-memory stand-in for the Dynamo UserRepo (per the no-jest.mock rule). */
class InMemoryUserRepo implements IUserRepo {
    store = new Map<string, User>();
    async getUser(userId: string) { return this.store.get(userId) ?? null; }
    async getUserByEmail(email: string) { return [...this.store.values()].find((u) => u.email === email) ?? null; }
    async getUserBySlug(slug: string) { return [...this.store.values()].find((u) => u.slug === slug) ?? null; }
    async createUser(userId: string, data: Record<string, any>) {
        const now = new Date().toISOString();
        this.store.set(userId, { userId, ...data, createdAt: now, updatedAt: now } as User);
    }
    async updateUser(userId: string, updates: Record<string, any>) {
        const cur = this.store.get(userId);
        if (cur) this.store.set(userId, { ...cur, ...updates, updatedAt: new Date().toISOString() });
    }
    async deleteUser(userId: string) { this.store.delete(userId); }
    async upsertUser(user: User) { this.store.set(user.userId, user); }
}

let pg: UserPgRepo;
let dynamo: InMemoryUserRepo;
let routing: RoutingUserRepo;

beforeAll(async () => {
    const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = {
        exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }),
    };
    await runMigrations(executor);

    pg = new UserPgRepo(drizzle(pglite) as unknown as PgDb);
});

function freshRouting() {
    dynamo = new InMemoryUserRepo();
    routing = new RoutingUserRepo(dynamo, pg);
}

afterEach(() => {
    delete process.env.DATA_BACKEND_IDENTITY;
    delete process.env.SHADOW_SAMPLE_IDENTITY;
    vi.restoreAllMocks();
});

describe('RoutingUserRepo state machine', () => {
    it('dynamo: writes touch Dynamo only', async () => {
        process.env.DATA_BACKEND_IDENTITY = 'dynamo';
        freshRouting();
        await routing.createUser('u_dyn', { email: 'dyn@example.com', fullName: 'Dyn Only' });
        expect(await dynamo.getUser('u_dyn')).not.toBeNull();
        expect(await pg.getUser('u_dyn')).toBeNull();
    });

    it('dual_dynamo: Dynamo is authoritative, pg receives the mirror', async () => {
        process.env.DATA_BACKEND_IDENTITY = 'dual_dynamo';
        process.env.SHADOW_SAMPLE_IDENTITY = '0'; // isolate write behaviour
        freshRouting();
        await routing.createUser('u_dual', { email: 'dual@example.com', fullName: 'Dual' });
        expect((await dynamo.getUser('u_dual'))?.fullName).toBe('Dual');
        expect((await pg.getUser('u_dual'))?.fullName).toBe('Dual'); // mirrored full entity

        await routing.updateUser('u_dual', { fullName: 'Dual Updated' });
        expect((await pg.getUser('u_dual'))?.fullName).toBe('Dual Updated');

        // reads come from Dynamo
        expect((await routing.getUser('u_dual'))?.fullName).toBe('Dual Updated');
    });

    it('dual_dynamo: a failing pg mirror never fails the request', async () => {
        process.env.DATA_BACKEND_IDENTITY = 'dual_dynamo';
        process.env.SHADOW_SAMPLE_IDENTITY = '0';
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const brokenPg = { ...pg, upsertUser: async () => { throw new Error('neon down'); } } as unknown as IUserRepo;
        dynamo = new InMemoryUserRepo();
        const r = new RoutingUserRepo(dynamo, brokenPg);

        await expect(r.createUser('u_broken', { email: 'b@example.com', fullName: 'B' })).resolves.toBeUndefined();
        expect(await dynamo.getUser('u_broken')).not.toBeNull(); // primary landed
        expect(spy).toHaveBeenCalledWith('[mirror-write-failure]', expect.stringContaining('neon down'));
    });

    it('dual_pg: pg is authoritative, Dynamo receives the mirror', async () => {
        process.env.DATA_BACKEND_IDENTITY = 'dual_pg';
        freshRouting();
        await routing.createUser('u_pgprim', { email: 'pgp@example.com', fullName: 'Pg Primary' });
        expect((await pg.getUser('u_pgprim'))?.fullName).toBe('Pg Primary');
        expect((await dynamo.getUser('u_pgprim'))?.fullName).toBe('Pg Primary'); // hot rollback path stays current

        await routing.deleteUser('u_pgprim');
        expect(await pg.getUser('u_pgprim')).toBeNull();
        expect(await dynamo.getUser('u_pgprim')).toBeNull();
    });

    it('pg: writes touch pg only', async () => {
        process.env.DATA_BACKEND_IDENTITY = 'pg';
        freshRouting();
        await routing.createUser('u_pgonly', { email: 'pgo@example.com', fullName: 'Pg Only' });
        expect(await pg.getUser('u_pgonly')).not.toBeNull();
        expect(await dynamo.getUser('u_pgonly')).toBeNull();
    });

    it('dual_dynamo: shadow read diff-logs when stores disagree', async () => {
        process.env.DATA_BACKEND_IDENTITY = 'dual_dynamo';
        process.env.SHADOW_SAMPLE_IDENTITY = '1';
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        freshRouting();
        // Seed Dynamo only — pg intentionally missing the row
        await dynamo.createUser('u_diff', { email: 'diff@example.com', fullName: 'Diff' });
        await routing.getUser('u_diff');
        expect(spy).toHaveBeenCalledWith('[shadow-read-diff]', expect.stringContaining('getUser'));
    });
});
