/**
 * 0070: one identity per organisation. An org with several profiles keeps the
 * one its pointer names; everything attributed to the others moves to it, and
 * per-profile configuration the canonical profile already has wins. The
 * migration is data-only and runs again to no effect.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import * as fs from 'fs';
import * as path from 'path';
import { runMigrations, splitStatements, migrationsDir, type SqlExecutor } from './migrate';

let pglite: PGlite;
let executor: SqlExecutor;

const FILE = '0070_consolidate_business_profiles.sql';

/** Apply every migration up to and including `file` on an empty database (later ones would remove what this test seeds). */
async function runMigrationsThrough(file: string) {
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'core-migrations-'));
    for (const name of fs.readdirSync(migrationsDir()).filter(n => n.endsWith('.sql') && n <= file)) fs.copyFileSync(path.join(migrationsDir(), name), path.join(dir, name));
    return runMigrations(executor, dir);
}

async function rerun0070() {
    const source = fs.readFileSync(path.join(migrationsDir(), FILE), 'utf-8');
    for (const statement of splitStatements(source)) await executor.exec(statement);
}

beforeAll(async () => {
    pglite = new PGlite({ extensions: { pg_trgm } });
    executor = {
        exec: async (statement: string) => {
            const res = await pglite.query(statement);
            return { rows: res.rows as any[] };
        },
    };
    // Apply everything up to and including 0070 on an empty database first.
    const ran = await runMigrationsThrough(FILE);
    expect(ran).toContain(FILE);

    // Then the shape the migration exists for: one org, two profiles, work
    // and configuration spread across both, the pointer on the first.
    const seed = [
        `INSERT INTO orgs (org_id, name, subscription_tier, seat_limit, currency, created_at, updated_at)
         VALUES ('org_two', 'Silk Rd Pty', 'pro', 2, 'AUD', now(), now())`,
        `INSERT INTO business_profiles (business_profile_id, org_id, business_name, created_at)
         VALUES ('bp_main', 'org_two', 'Silk Rd Pty', now() - interval '2 days'),
                ('bp_side', 'org_two', 'Manhattan Bombers', now() - interval '1 day')`,
        `UPDATE orgs SET business_profile_id = 'bp_main' WHERE org_id = 'org_two'`,
        `INSERT INTO invoices (invoice_id, org_id, owner_id, created_by, invoice_number, business_profile_id, created_at, updated_at)
         VALUES ('inv_a', 'org_two', 'u1', 'u1', 'INV-A', 'bp_main', now(), now()),
                ('inv_b', 'org_two', 'u1', 'u1', 'INV-B', 'bp_side', now(), now())`,
        `INSERT INTO profile_setup_checklist (org_id, business_profile_id, item_id, done, revision, updated_by, done_by, done_at)
         VALUES ('org_two', 'bp_main', 'abn', true, 1, 'u1', 'u1', now()),
                ('org_two', 'bp_side', 'abn', false, 1, 'u1', NULL, NULL),
                ('org_two', 'bp_side', 'gst', true, 1, 'u1', 'u1', now())`,
        `INSERT INTO orgs (org_id, name, subscription_tier, seat_limit, currency, created_at, updated_at)
         VALUES ('org_unpointed', 'Loose Ltd', 'free', 0, 'AUD', now(), now())`,
        `INSERT INTO business_profiles (business_profile_id, org_id, business_name, created_at)
         VALUES ('bp_late', 'org_unpointed', 'Later', now()),
                ('bp_early', 'org_unpointed', 'Earlier', now() - interval '3 days')`,
    ];
    for (const statement of seed) await pglite.query(statement);
    await rerun0070();
});

describe('0070 consolidate business profiles', () => {
    it('keeps the profile the org points at and drops the others', async () => {
        const { rows } = await pglite.query<any>(`SELECT business_profile_id FROM business_profiles WHERE org_id = 'org_two'`);
        expect(rows.map(r => r.business_profile_id)).toEqual(['bp_main']);
    });

    it('re-attributes work carried by another profile to the one that stays', async () => {
        const { rows } = await pglite.query<any>(`SELECT invoice_id, business_profile_id FROM invoices WHERE org_id = 'org_two' ORDER BY invoice_id`);
        expect(rows).toEqual([
            { invoice_id: 'inv_a', business_profile_id: 'bp_main' },
            { invoice_id: 'inv_b', business_profile_id: 'bp_main' },
        ]);
    });

    it("on a keyed configuration table the canonical profile's rows win and the others go", async () => {
        const { rows } = await pglite.query<any>(
            `SELECT business_profile_id, item_id, done FROM profile_setup_checklist WHERE org_id = 'org_two' ORDER BY item_id`,
        );
        // The immutability trigger refuses the re-point, so bp_side's rows are
        // dropped rather than merged; bp_main's own 'abn' row is untouched.
        expect(rows).toEqual([{ business_profile_id: 'bp_main', item_id: 'abn', done: true }]);
    });

    it('an org with profiles but no pointer is pointed at its earliest', async () => {
        const { rows } = await pglite.query<any>(`SELECT business_profile_id FROM orgs WHERE org_id = 'org_unpointed'`);
        expect(rows[0].business_profile_id).toBe('bp_early');
        const left = await pglite.query<any>(`SELECT business_profile_id FROM business_profiles WHERE org_id = 'org_unpointed'`);
        expect(left.rows.map(r => r.business_profile_id)).toEqual(['bp_early']);
    });

    it('runs again to no effect', async () => {
        const before = await pglite.query<any>(`SELECT count(*)::int AS n FROM business_profiles`);
        await rerun0070();
        const after = await pglite.query<any>(`SELECT count(*)::int AS n FROM business_profiles`);
        expect(after.rows[0].n).toBe(before.rows[0].n);
    });
});
