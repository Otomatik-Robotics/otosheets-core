import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { ProfilePayerAliasPgRepo } from './profile.pg';
import { PayerAliasPgRepo } from './repo.pg';
import { ClientPgRepo } from '../client/repo.pg';
import { ClientDynamoRepo } from '../client/repo';
import type { IDdb } from '../ddbPort';
import { Tables } from '../tables';

let pg: PGlite; let db: PgDb;
const scope = (businessProfileId = 'A', orgId = 'org') => new ProfilePayerAliasPgRepo({ orgId, businessProfileId }, db);
beforeAll(async () => {
    pg = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async s => ({ rows: (await pg.query(s)).rows as any[] }) };
    await runMigrations(executor); await runMigrations(executor);
    db = drizzle(pg) as unknown as PgDb;
    await pg.exec(`INSERT INTO orgs(org_id,name) VALUES ('org','Owned'),('foreign','Foreign');
        INSERT INTO business_profiles(business_profile_id,org_id) VALUES ('A','org'),('B','org'),('F','foreign');
        INSERT INTO clients(client_id,org_id,business_profile_id,created_by,name,email) VALUES
        ('a','org','A','user','Acme Building','same@test.example'),('b','org','B','user','Acme Building','same@test.example'),
        ('null','org',NULL,'user','Acme Building','same@test.example'),('f','foreign','F','user','Acme Building','same@test.example');`);
});

describe('profile payer aliases on real Postgres-compatible storage', () => {
    it('isolates the same payer key across profiles and leaves the legacy map unchanged', async () => {
        const legacy = new PayerAliasPgRepo(db);
        await legacy.upsert('org', 'same payer', 'null');
        expect(await scope().upsert('same payer', 'a', 'user')).toBe(true);
        expect(await scope('B').upsert('same payer', 'b', 'user')).toBe(true);
        expect((await scope().lookup(['same payer'])).get('same payer')).toBe('a');
        expect((await scope('B').lookup(['same payer'])).get('same payer')).toBe('b');
        expect((await legacy.lookup('org', ['same payer'])).get('same payer')).toBe('null');
        await scope().upsert('same payer', 'a', 'user');
        expect((await scope().list()).items.filter(r => r.payerKey === 'same payer')).toHaveLength(1);
        await scope().remove('same payer');
        expect((await scope().lookup(['same payer'])).size).toBe(0);
        expect((await scope('B').lookup(['same payer'])).get('same payer')).toBe('b');
    });
    it.each(['b', 'f', 'null', 'missing'])('rejects %s client before inserting or replacing an alias', async client => {
        await scope().upsert('guarded', 'a');
        expect(await scope().upsert('guarded', client)).toBe(false);
        expect((await scope().lookup(['guarded'])).get('guarded')).toBe('a');
    });
    it('quarantines malformed client references and applies ownership before pagination', async () => {
        await pg.exec(`INSERT INTO profile_payer_aliases(org_id,business_profile_id,payer_key,client_id) VALUES
          ('org','A','00 foreign','b'),('org','A','01 null','null'),('org','A','02 otherorg','f');`);
        await scope().upsert('10 own', 'a'); await scope().upsert('11 own', 'a');
        const page = await scope().list({ limit: 1 });
        expect(page.items.map(i => i.payerKey)).toEqual(['10 own']); expect(page.nextToken).toBeTruthy();
        const next = await scope().list({ limit: 1, nextToken: page.nextToken });
        expect(next.items.map(i => i.payerKey)).toEqual(['11 own']);
        expect((await scope().lookup(['00 foreign', '01 null', '02 otherorg'])).size).toBe(0);
        await expect(scope('B').list({ nextToken: page.nextToken })).rejects.toThrow('cursor');
        await expect(scope('A', 'foreign').list({ nextToken: page.nextToken })).rejects.toThrow('cursor');
        await expect(scope().list({ nextToken: page.nextToken + '=' })).rejects.toThrow('cursor');
    });
    it('cannot use a profile belonging to another organisation, even for malformed client data', async () => {
        await pg.exec(`INSERT INTO clients(client_id,org_id,business_profile_id,created_by,name) VALUES ('badbinding','org','F','user','Acme Building');`);
        expect(await scope('F').upsert('badbinding', 'badbinding')).toBe(false);
    });
    it('scopes client similarity before its limit, exact batch reads and email lookup', async () => {
        const clients = new ClientPgRepo(db);
        expect((await clients.findSimilarClients('org', 'Acme Building', { businessProfileId: 'A', limit: 1 })).map(c => c.clientId)).toEqual(['a']);
        expect((await clients.batchGetClients('org', ['a', 'b', 'null', 'f'], 'A')).map(c => c.clientId)).toEqual(['a']);
        expect((await clients.findClientByEmail('org', 'same@test.example', 'A'))?.clientId).toBe('a');
        expect((await clients.batchGetClients('org', ['a'], '')).length).toBe(0);
    });
    it('scopes Dynamo exact batch responses for callers routed to that backend', async () => {
        const repo = new ClientDynamoRepo({ batchGet: async () => ({ Responses: { [Tables.CLIENTS]: [
            { orgId: 'org', clientId: 'a', businessProfileId: 'A' }, { orgId: 'org', clientId: 'b', businessProfileId: 'B' },
            { orgId: 'org', clientId: 'null', businessProfileId: null },
        ] } }) } as unknown as IDdb);
        expect((await repo.batchGetClients('org', ['a', 'b', 'null'], 'A')).map(c => c.clientId)).toEqual(['a']);
    });
    it('rejects missing scope and invalid page limits', async () => {
        expect(() => scope('')).toThrow('scope');
        for (const limit of [0, 101, NaN, 1.5]) await expect(scope().list({ limit })).rejects.toThrow('limit');
    });
});
