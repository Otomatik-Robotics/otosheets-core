/**
 * 0074: inbound email is gone, so is the users.email_connections blob. The
 * migration drops the column, is safe to run twice, and touches nothing else
 * on the row.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import * as fs from 'fs';
import * as path from 'path';
import { runMigrations, splitStatements, migrationsDir, type SqlExecutor } from './migrate';

let pglite: PGlite;
let executor: SqlExecutor;
const FILE = '0074_drop_email_connections.sql';
const q = async (sql: string) => (await pglite.query<any>(sql)).rows;

beforeAll(async () => {
    pglite = new PGlite({ extensions: { pg_trgm } });
    executor = { exec: async (statement: string) => ({ rows: (await pglite.query(statement)).rows as any[] }) };
    const upTo0073 = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'core-0074-'));
    for (const name of fs.readdirSync(migrationsDir()).filter(n => n.endsWith('.sql') && n < FILE)) fs.copyFileSync(path.join(migrationsDir(), name), path.join(upTo0073, name));
    await runMigrations(executor, upTo0073);
    await pglite.query(`INSERT INTO users (user_id, email, email_connections, calendar_connections, created_at, updated_at) VALUES ('u1', 'leon@example.com', '{"gmail":{"token":"dead"}}', '{"google":{"status":"active"}}', now(), now())`);
    fs.copyFileSync(path.join(migrationsDir(), FILE), path.join(upTo0073, FILE));
    const ran = await runMigrations(executor, upTo0073);
    expect(ran).toEqual([FILE]);
});

describe('0074 drop email connections', () => {
    it('leaves no email_connections column on users', async () => {
        expect(await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='email_connections'`)).toEqual([]);
    });

    it('keeps the row and its calendar connection', async () => {
        expect(await q(`SELECT email, calendar_connections FROM users WHERE user_id = 'u1'`)).toEqual([{ email: 'leon@example.com', calendar_connections: { google: { status: 'active' } } }]);
    });

    it('is idempotent', async () => {
        for (const statement of splitStatements(fs.readFileSync(path.join(migrationsDir(), FILE), 'utf-8'))) await executor.exec(statement);
        expect(await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='email_connections'`)).toEqual([]);
    });
});
