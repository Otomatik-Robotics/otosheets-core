import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { BasPeriodPgRepo } from './repo.pg';
import { parsePeriod } from './period';
import type { BasLodgementInput } from './schema';

let db: PgDb;
let repo: BasPeriodPgRepo;
let pglite: PGlite;

const ORG = 'org_1';
const q1 = parsePeriod('FY26/27-Q1')!;
const q2 = parsePeriod('FY26/27-Q2')!;
const q4prev = parsePeriod('FY25/26-Q4')!;

const lodgement = (over: Partial<BasLodgementInput> = {}): BasLodgementInput => ({
    ...q1,
    lodgedBy: 'user_1',
    figures: { gstCollected: 1200, gstPaid: 340.5, netGst: 859.5, invoiceCount: 9 },
    confidence: 90,
    reasons: [{ code: 'BANK_ROWS_UNRECONCILED', count: 2 }],
    ...over,
});

beforeAll(async () => {
    pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    await pglite.query(`INSERT INTO orgs (org_id, name) VALUES ('${ORG}', 'Acme'), ('org_2', 'Other')`);
    repo = new BasPeriodPgRepo(db);
});

describe('BasPeriodPgRepo', () => {
    it('stampReminder inserts the row on first use and is the cron idempotency guard', async () => {
        expect(await repo.stampReminder(ORG, q4prev, 'before')).toBe(true);
        expect(await repo.stampReminder(ORG, q4prev, 'before')).toBe(false); // double-fired cron
        expect(await repo.stampReminder(ORG, q4prev, 'due')).toBe(true);     // the other kind is independent
        expect(await repo.stampReminder(ORG, q4prev, 'due')).toBe(false);
        const got = await repo.get(ORG, q4prev.period);
        expect(got).toMatchObject({
            orgId: ORG, period: 'FY25/26-Q4', fy: 'FY25/26', quarter: 4,
            periodStart: '2026-04-01', periodEnd: '2026-06-30', dueDate: '2026-07-28',
            lodgedAt: null, figures: null, confidence: null, reasons: null,
        });
        expect(got?.reminderBeforeAt).toBeTruthy();
        expect(got?.reminderDueAt).toBeTruthy();
        expect(got?.lodgedBy).toBeUndefined();
    });

    it('markLodged upserts a fresh row, then refuses a second lodgement', async () => {
        expect(await repo.markLodged(ORG, lodgement())).toBe('lodged');
        expect(await repo.markLodged(ORG, lodgement({ figures: { gstCollected: 1 }, lodgedBy: 'user_2' }))).toBe('already_lodged');
        const got = await repo.get(ORG, q1.period);
        expect(got?.lodgedAt).toBeTruthy();
        expect(got?.lodgedBy).toBe('user_1');                               // first snapshot kept
        expect(got?.figures).toEqual({ gstCollected: 1200, gstPaid: 340.5, netGst: 859.5, invoiceCount: 9 });
        expect(got?.confidence).toBe(90);
        expect(got?.reasons).toEqual([{ code: 'BANK_ROWS_UNRECONCILED', count: 2 }]);
        expect(got?.reminderBeforeAt).toBeNull();
    });

    it('markLodged lodges an existing reminder-only row without losing its stamps', async () => {
        expect(await repo.markLodged(ORG, lodgement({ ...q4prev, confidence: 100, reasons: [] }))).toBe('lodged');
        const got = await repo.get(ORG, q4prev.period);
        expect(got?.lodgedAt).toBeTruthy();
        expect(got?.confidence).toBe(100);
        expect(got?.reasons).toEqual([]);
        expect(got?.reminderBeforeAt).toBeTruthy(); // untouched
    });

    it('a reminder cannot be re-sent for a lodged quarter that already had one, but a fresh kind still stamps once', async () => {
        expect(await repo.stampReminder(ORG, q1, 'before')).toBe(true);
        expect(await repo.stampReminder(ORG, q1, 'before')).toBe(false);
        expect((await repo.get(ORG, q1.period))?.lodgedAt).toBeTruthy(); // lodgement intact
    });

    it('unlodge reopens the quarter and clears the snapshot; a second call is a no-op', async () => {
        expect(await repo.unlodge(ORG, q1.period)).toBe(true);
        expect(await repo.unlodge(ORG, q1.period)).toBe(false);
        expect(await repo.unlodge(ORG, 'FY30/31-Q1')).toBe(false);
        const got = await repo.get(ORG, q1.period);
        expect(got?.lodgedAt).toBeNull();
        expect(got?.lodgedBy).toBeUndefined();
        expect(got?.figures).toBeNull();
        expect(got?.confidence).toBeNull();
        expect(got?.reasons).toBeNull();
        expect(got?.reminderBeforeAt).toBeTruthy(); // reminder history survives
        // …and it can be lodged again afterwards.
        expect(await repo.markLodged(ORG, lodgement({ confidence: 75 }))).toBe('lodged');
    });

    it('list is newest quarter first with a keyset cursor; listLodged is by lodgement time', async () => {
        await repo.stampReminder(ORG, q2, 'before');
        await repo.stampReminder('org_2', q2, 'before'); // another org — never visible here
        const p1 = await repo.list(ORG, { limit: 2 });
        expect(p1.items.map((p) => p.period)).toEqual(['FY26/27-Q2', 'FY26/27-Q1']);
        expect(p1.lastEvaluatedKey).toEqual({ orgId: ORG, periodEnd: '2026-09-30', period: 'FY26/27-Q1' });
        const p2 = await repo.list(ORG, { limit: 2, exclusiveStartKey: p1.lastEvaluatedKey });
        expect(p2.items.map((p) => p.period)).toEqual(['FY25/26-Q4']);
        expect(p2.lastEvaluatedKey).toBeUndefined();

        const lodged = await repo.listLodged(ORG);
        expect(lodged.map((p) => p.period)).toEqual(['FY26/27-Q1', 'FY25/26-Q4']); // Q1 re-lodged most recently
        expect(lodged.every((p) => p.lodgedAt)).toBe(true);
        expect(await repo.listLodged(ORG, 1)).toHaveLength(1);
        expect(await repo.listLodged('org_2')).toEqual([]);
    });
});
