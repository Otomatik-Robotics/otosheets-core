/**
 * 0072: the contract step. After it there is no business_profiles table, no
 * business_profile_id column anywhere, none of the per-profile configuration
 * tables of removed modules, and the identity copied by 0071 is intact.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import * as fs from 'fs';
import * as path from 'path';
import { runMigrations, splitStatements, migrationsDir, type SqlExecutor } from './migrate';

let pglite: PGlite;
let executor: SqlExecutor;
const FILE = '0072_drop_business_profiles.sql';

async function rerun0072() {
    const source = fs.readFileSync(path.join(migrationsDir(), FILE), 'utf-8');
    for (const statement of splitStatements(source)) await executor.exec(statement);
}
const q = async (sql: string) => (await pglite.query<any>(sql)).rows;

beforeAll(async () => {
    pglite = new PGlite({ extensions: { pg_trgm } });
    executor = { exec: async (statement: string) => ({ rows: (await pglite.query(statement)).rows as any[] }) };
    // Run everything up to 0071 on an empty database, seed an organisation with
    // a profile, then apply 0072 on top of real data.
    const upTo0071 = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'core-0072-'));
    for (const name of fs.readdirSync(migrationsDir()).filter(n => n.endsWith('.sql') && n < FILE)) fs.copyFileSync(path.join(migrationsDir(), name), path.join(upTo0071, name));
    await runMigrations(executor, upTo0071);
    for (const statement of [
        `INSERT INTO orgs (org_id, name, subscription_tier, seat_limit, currency, created_at, updated_at) VALUES ('org_one', 'Silk Rd', 'pro', 2, 'AUD', now(), now())`,
        `INSERT INTO business_profiles (business_profile_id, org_id, business_name, abn, created_at) VALUES ('bp_one', 'org_one', 'Silk Rd', '51 824 753 556', now())`,
        `UPDATE orgs SET business_profile_id = 'bp_one' WHERE org_id = 'org_one'`,
        `INSERT INTO invoices (invoice_id, org_id, owner_id, created_by, invoice_number, business_profile_id, created_at, updated_at) VALUES ('inv_a', 'org_one', 'u1', 'u1', 'INV-A', 'bp_one', now(), now())`,
    ]) await pglite.query(statement);
    // 0071 already copied the profile; run it once more so the seeded profile lands on orgs.
    for (const statement of splitStatements(fs.readFileSync(path.join(migrationsDir(), '0071_identity_on_orgs.sql'), 'utf-8'))) await executor.exec(statement);
    // Now the real runner applies what is left: 0072.
    const ran = await runMigrations(executor);
    expect(ran).toEqual([FILE]);
});

describe('0072 drop business profiles', () => {
    it('leaves no business_profile_id column and no business_profiles table', async () => {
        expect(await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='business_profile_id'`)).toEqual([]);
        expect(await q(`SELECT to_regclass('public.business_profiles') AS t`)).toEqual([{ t: null }]);
    });

    it('drops the per-profile configuration tables and their trigger functions', async () => {
        for (const table of ['profile_signature_requests', 'profile_setup_checklist', 'profile_document_requests', 'profile_document_request_files', 'profile_document_request_attachments', 'profile_payer_aliases', 'business_profile_bas_periods']) {
            expect(await q(`SELECT to_regclass('public.${table}') AS t`)).toEqual([{ t: null }]);
        }
        expect(await q(`SELECT proname FROM pg_proc WHERE proname LIKE 'preserve_profile%' OR proname = 'preserve_signature_request_identity'`)).toEqual([]);
    });

    it('keeps the identity 0071 put on the organisation and the rows that carried the column', async () => {
        expect(await q(`SELECT business_name, abn FROM orgs WHERE org_id = 'org_one'`)).toEqual([{ business_name: 'Silk Rd', abn: '51 824 753 556' }]);
        expect(await q(`SELECT invoice_id FROM invoices WHERE org_id = 'org_one'`)).toEqual([{ invoice_id: 'inv_a' }]);
    });

    it('runs again to no effect', async () => {
        await rerun0072();
        expect(await q(`SELECT count(*)::int AS n FROM invoices`)).toEqual([{ n: 1 }]);
    });
});
