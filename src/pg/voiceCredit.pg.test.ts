import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from './migrate';
import type { PgDb } from './client';
import { VoiceCreditPgRepo } from '../voiceCredit/repo.pg';

let db: PgDb;
beforeAll(async () => {
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const ex: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(ex);
    db = drizzle(pglite) as unknown as PgDb;
    await pglite.query("INSERT INTO orgs (org_id, name) VALUES ('org_1', 'Acme'), ('org_bf', 'Backfill Co')");
});

describe('VoiceCreditPgRepo', () => {
    const r = () => new VoiceCreditPgRepo(db, db);

    it('credit/debit/grant maintain balance; all idempotent on deterministic keys', async () => {
        expect(await r().getBalance('org_1')).toBe(0);

        expect(await r().credit('org_1', 5000, { stripeSessionId: 'sess_1' })).toBe(5000);
        // Webhook replay — no double count
        expect(await r().credit('org_1', 5000, { stripeSessionId: 'sess_1' })).toBe(5000);

        expect(await r().debit('org_1', 1200, { callId: 'call_1' })).toBe(3800);
        expect(await r().debit('org_1', 1200, { callId: 'call_1' })).toBe(3800); // /outcome replay

        expect(await r().grantMonthlyAllowance('org_1', '2026-07', 2000)).toBe(5800);
        expect(await r().grantMonthlyAllowance('org_1', '2026-07', 2000)).toBe(5800); // same period no-op
        expect(await r().grantMonthlyAllowance('org_1', '2026-08', 2000)).toBe(7800); // new period grants

        expect(await r().getPeriodGrant('org_1', '2026-07')).toBe(2000);
        expect(await r().getPeriodGrant('org_1', '2026-09')).toBe(0);

        const ledger = await r().listLedger('org_1', 10);
        expect(ledger).toHaveLength(4); // topup, debit, 2 grants
        expect(ledger.every(e => e.sk.startsWith('WALLET#LEDGER#'))).toBe(true);
        // balance == sum of ledger (the §6.4 invariant)
        expect(ledger.reduce((n, e) => n + (e.amountCents ?? 0), 0)).toBe(await r().getBalance('org_1'));
    });

    it('upsertWalletItem copies Dynamo balance + ledger items (backfill)', async () => {
        const repo = new VoiceCreditPgRepo(db);
        await repo.upsertWalletItem({ orgId: 'org_bf', sk: 'WALLET#BALANCE', balanceCents: 999, currency: 'aud', updatedAt: '2026-07-01T00:00:00.000Z' });
        await repo.upsertWalletItem({ orgId: 'org_bf', sk: 'WALLET#LEDGER#TOPUP#s9', type: 'topup', amountCents: 999, stripeSessionId: 's9', createdAt: '2026-07-01T00:00:00.000Z' });
        // Skip non-wallet items (AGENT#/CALL# share the Dynamo partition but aren't voice-credit).
        await repo.upsertWalletItem({ orgId: 'org_bf', sk: 'AGENT#a1', name: 'ignored' });
        expect(await repo.getBalance('org_bf')).toBe(999);
        const ledger = await repo.listLedger('org_bf', 10);
        expect(ledger).toHaveLength(1);
        expect(ledger[0]).toMatchObject({ sk: 'WALLET#LEDGER#TOPUP#s9', amountCents: 999, stripeSessionId: 's9' });
    });
});
