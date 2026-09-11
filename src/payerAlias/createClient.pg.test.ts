import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { ProfilePayerAliasPgRepo } from './profile.pg';
const mocks = vi.hoisted(() => ({ mode: vi.fn() }));
vi.mock('../dataBackend', () => ({ dataBackend: mocks.mode }));
let pg: PGlite; let db: PgDb;
const repo = (profile = 'A', org = 'org') => new ProfilePayerAliasPgRepo({ orgId: org, businessProfileId: profile }, db);
const input = (payerKey: string) => ({ payerKey, name: `Client ${payerKey}`, createdBy: 'actor', isCompany: true, phone: '123' });
const clients = async (name: string) => (await pg.query('SELECT client_id FROM clients WHERE name = $1', [name])).rows;
beforeAll(async () => {
    pg = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async s => ({ rows: (await pg.query(s)).rows as any[] }) };
    await runMigrations(executor); db = drizzle(pg) as unknown as PgDb;
    await pg.exec(`INSERT INTO orgs(org_id,name) VALUES ('org','Owned'),('foreign','Foreign');
        INSERT INTO business_profiles(business_profile_id,org_id) VALUES ('A','org'),('B','org'),('F','foreign');`);
});
beforeEach(() => mocks.mode.mockResolvedValue('pg'));

describe('atomic payer client creation', () => {
    it('replays the same request with one client and alias, preserving original creation fields', async () => {
        const request = input('replay'); const first = await repo().createClient(request); const retry = await repo().createClient(request);
        expect(first.kind).toBe('created'); expect(retry.kind).toBe('replayed');
        if (!('client' in first) || !('client' in retry)) throw new Error('missing result');
        expect(first.client).toEqual(retry.client); expect(await clients(request.name)).toHaveLength(1);
        expect((await repo().lookup(['replay'])).get('replay')).toBe(first.clientId);
        expect(await repo().createClient({ ...request, name: 'Changed request' })).toEqual({ kind: 'conflict' });
        expect(await clients('Changed request')).toHaveLength(0);
        const other = await repo('B').createClient(request);
        expect(other.kind).toBe('created'); expect('clientId' in other && other.clientId).not.toBe(first.clientId);
    });
    it('concurrent same-request calls create once with a stable replay identity', async () => {
        const outcomes = await Promise.all([repo().createClient(input('concurrent')), repo().createClient(input('concurrent'))]);
        expect(outcomes.map(o => o.kind).sort()).toEqual(['created', 'replayed']);
        expect(await clients('Client concurrent')).toHaveLength(1);
    });
    it('rolls back the client when alias insertion throws, then retries safely', async () => {
        await pg.exec(`CREATE FUNCTION fail_payer_alias() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.payer_key = 'failure' THEN RAISE EXCEPTION 'injected alias failure'; END IF; RETURN NEW; END $$;
          CREATE TRIGGER fail_payer_alias BEFORE INSERT ON profile_payer_aliases FOR EACH ROW EXECUTE FUNCTION fail_payer_alias();`);
        try {
            await expect(repo().createClient(input('failure'))).rejects.toThrow();
            expect(await clients('Client failure')).toHaveLength(0); expect((await repo().lookup(['failure'])).size).toBe(0);
        } finally { await pg.exec('DROP TRIGGER fail_payer_alias ON profile_payer_aliases; DROP FUNCTION fail_payer_alias();'); }
        expect((await repo().createClient(input('failure'))).kind).toBe('created');
        expect(await clients('Client failure')).toHaveLength(1);
    });
    it('a suppressed conditional alias insert rolls back the client instead of claiming success', async () => {
        await pg.exec(`CREATE FUNCTION suppress_payer_alias() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.payer_key = 'suppressed' THEN RETURN NULL; END IF; RETURN NEW; END $$;
          CREATE TRIGGER suppress_payer_alias BEFORE INSERT ON profile_payer_aliases FOR EACH ROW EXECUTE FUNCTION suppress_payer_alias();`);
        try {
            expect(await repo().createClient(input('suppressed'))).toEqual({ kind: 'conflict' });
            expect(await clients('Client suppressed')).toHaveLength(0); expect((await repo().lookup(['suppressed'])).size).toBe(0);
        } finally { await pg.exec('DROP TRIGGER suppress_payer_alias ON profile_payer_aliases; DROP FUNCTION suppress_payer_alias();'); }
    });
    it('does not adopt a foreign client or silently recreate an alias removed after success', async () => {
        const result = await repo().createClient(input('foreign'));
        if (!('clientId' in result)) throw new Error('missing result');
        await pg.query("UPDATE clients SET org_id = 'foreign', business_profile_id = 'F' WHERE client_id = $1", [result.clientId]);
        expect(await repo().createClient(input('foreign'))).toEqual({ kind: 'conflict' });
        await repo().createClient(input('unlinked')); await repo().remove('unlinked');
        expect(await repo().createClient(input('unlinked'))).toEqual({ kind: 'conflict' });
        expect((await repo().lookup(['unlinked'])).size).toBe(0);
    });
    it.each(['dynamo', 'dual_pg', 'dual_dynamo'])('refuses %s before any client or alias effect', async mode => {
        mocks.mode.mockResolvedValue(mode);
        await expect(repo().createClient(input(`mode-${mode}`))).rejects.toThrow('requires billing-core pg');
        expect(await clients(`Client mode-${mode}`)).toHaveLength(0);
        expect((await repo().lookup([`mode-${mode}`])).size).toBe(0);
    });
    it('checks email uniqueness in the scoped creation transaction without rejecting another profile', async () => {
        const request = { ...input('email'), isCompany: false, email: 'Same@Test.Example' };
        expect((await repo().createClient(request)).kind).toBe('created');
        expect(await repo().createClient({ ...request, payerKey: 'different email payer' })).toEqual({ kind: 'conflict' });
        expect((await repo('B').createClient(request)).kind).toBe('created');
    });
    it('rejects foreign or missing profile ownership before writes', async () => {
        expect(await repo('F').createClient(input('bad-scope'))).toEqual({ kind: 'not_found' });
        expect(await repo('missing').createClient(input('bad-scope'))).toEqual({ kind: 'not_found' });
        expect(await clients('Client bad-scope')).toHaveLength(0);
    });
});
