import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { MerchantCategoryPgRepo } from './repo.pg';
import { PROMOTION_MIN_ORGS } from './schema';

let db: PgDb;
let repo: MerchantCategoryPgRepo;

async function fresh(): Promise<void> {
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    repo = new MerchantCategoryPgRepo(db);
}

beforeEach(fresh);

const agree = (orgId: string, category = 'HARDWARE', gst: string | null = 'GST', merchantKey = 'bunnings warehouse') =>
    repo.recordAgreement({ merchantKey, category, gstTreatment: gst, orgId });

describe('MerchantCategoryPgRepo — promotion gate', () => {
    it('does not promote below PROMOTION_MIN_ORGS distinct orgs', async () => {
        for (let i = 1; i < PROMOTION_MIN_ORGS; i++) await agree(`org_${i}`);
        const hits = await repo.lookup(['bunnings warehouse']);
        expect(hits.size).toBe(0);
    });

    it('promotes once PROMOTION_MIN_ORGS distinct orgs agree', async () => {
        for (let i = 1; i <= PROMOTION_MIN_ORGS; i++) await agree(`org_${i}`);
        const hits = await repo.lookup(['bunnings warehouse']);
        const hit = hits.get('bunnings warehouse');
        expect(hit).toBeDefined();
        expect(hit!.category).toBe('HARDWARE');
        expect(hit!.gstTreatment).toBe('GST');
        expect(hit!.agreeOrgCount).toBe(PROMOTION_MIN_ORGS);
    });

    it('repeat votes from the SAME org never advance the distinct-org gate (idempotent)', async () => {
        // Two orgs, but org_1 votes many times (statement reprocess / replay).
        for (let i = 0; i < 5; i++) await agree('org_1');
        await agree('org_2');
        expect((await repo.lookup(['bunnings warehouse'])).size).toBe(0); // still only 2 distinct orgs
        await agree('org_3');
        expect((await repo.lookup(['bunnings warehouse'])).size).toBe(1); // 3rd distinct org promotes it
    });
});

describe('MerchantCategoryPgRepo — plurality across distinct orgs', () => {
    it('the winning category is the plurality vote, not the loudest single org', async () => {
        // 3 orgs say HARDWARE, 1 org says OFFICE (even if it votes twice).
        await agree('org_1', 'HARDWARE');
        await agree('org_2', 'HARDWARE');
        await agree('org_3', 'HARDWARE');
        await agree('org_4', 'OFFICE');
        await agree('org_4', 'OFFICE');
        const hit = (await repo.lookup(['bunnings warehouse'])).get('bunnings warehouse');
        expect(hit!.category).toBe('HARDWARE');
        expect(hit!.agreeOrgCount).toBe(3);
    });

    it('a new plurality overtakes the previous winner as orgs shift', async () => {
        await agree('org_1', 'OFFICE');
        await agree('org_2', 'OFFICE');
        await agree('org_3', 'OFFICE'); // OFFICE promoted (3 orgs)
        expect((await repo.lookup(['bunnings warehouse'])).get('bunnings warehouse')!.category).toBe('OFFICE');
        await agree('org_4', 'HARDWARE');
        await agree('org_5', 'HARDWARE');
        await agree('org_6', 'HARDWARE');
        await agree('org_7', 'HARDWARE'); // HARDWARE now the plurality (4 > 3)
        expect((await repo.lookup(['bunnings warehouse'])).get('bunnings warehouse')!.category).toBe('HARDWARE');
    });

    it('caches the modal GST treatment for the winning category', async () => {
        await agree('org_1', 'HARDWARE', 'GST');
        await agree('org_2', 'HARDWARE', 'GST');
        await agree('org_3', 'HARDWARE', 'GST_FREE');
        const hit = (await repo.lookup(['bunnings warehouse'])).get('bunnings warehouse');
        expect(hit!.gstTreatment).toBe('GST'); // modal across the winning category's votes
    });
});

describe('MerchantCategoryPgRepo — lookup + guards', () => {
    it('batch lookup returns only promoted merchants', async () => {
        for (let i = 1; i <= PROMOTION_MIN_ORGS; i++) await agree(`org_${i}`, 'HARDWARE', 'GST', 'bunnings warehouse');
        await agree('org_1', 'SOFTWARE', 'GST', 'adobe'); // only 1 org — not promoted
        const hits = await repo.lookup(['bunnings warehouse', 'adobe', 'never seen']);
        expect([...hits.keys()]).toEqual(['bunnings warehouse']);
    });

    it('ignores blank keys/orgs/categories', async () => {
        await repo.recordAgreement({ merchantKey: '', category: 'HARDWARE', orgId: 'org_1' });
        await repo.recordAgreement({ merchantKey: 'x', category: '', orgId: 'org_1' });
        await repo.recordAgreement({ merchantKey: 'x', category: 'HARDWARE', orgId: '' });
        expect((await repo.lookup(['x'])).size).toBe(0);
        expect(await repo.lookup([])).toEqual(new Map());
    });
});
