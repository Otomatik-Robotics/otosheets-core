import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { receipts } from '../pg/schema/opsEntities';
import { ReceiptPgRepo } from './repo.pg';

/**
 * The AI risk flag is written once at ingest and no code path has ever changed
 * it, so a flagged receipt stayed on the Home card forever and the only way to
 * clear it was to delete the receipt. `reviewed_at` is the acknowledgement.
 */
let db: PgDb;
let repo: ReceiptPgRepo;

const D = (s: string) => new Date(s);

function receipt(over: Record<string, any>) {
    return {
        orgId: 'org_1',
        ownerId: 'u_1',
        createdBy: 'u_1',
        status: 'PROCESSED',
        totalAmount: '100.00',
        date: '2026-03-01',
        createdAt: D('2026-03-01T00:00:00Z'),
        updatedAt: D('2026-03-01T00:00:00Z'),
        ...over,
    } as any;
}

beforeAll(async () => {
    const pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    await pglite.query("INSERT INTO orgs (org_id, name) VALUES ('org_1', 'Acme')");
    repo = new ReceiptPgRepo(db);

    await db.insert(receipts).values([
        receipt({ receiptId: 'r_high_1', aiRiskLevel: 'HIGH' }),
        receipt({ receiptId: 'r_high_2', aiRiskLevel: 'HIGH' }),
        receipt({ receiptId: 'r_low', aiRiskLevel: 'LOW' }),
        receipt({ receiptId: 'r_none', aiRiskLevel: null }),
    ]);
});

describe('highRiskCount', () => {
    it('counts the flagged receipts to begin with', async () => {
        const s = await repo.summarizeReceipts({ orgId: 'org_1' } as any);
        expect(s.highRiskCount).toBe(2);
    });

    it('drops one once it is acknowledged, without touching the flag itself', async () => {
        await repo.updateReceipt('org_1', 'u_1', 'r_high_1', {
            reviewedAt: new Date().toISOString(),
            reviewedBy: 'u_1',
        });
        const s = await repo.summarizeReceipts({ orgId: 'org_1' } as any);
        expect(s.highRiskCount).toBe(1);

        // The risk level is history, not a toggle: it still says HIGH.
        const [row] = await db.select().from(receipts).where(eq(receipts.receiptId, 'r_high_1'));
        expect(row.aiRiskLevel).toBe('HIGH');
        expect(row.reviewedAt).not.toBeNull();
    });

    it('is reversible — un-reviewing puts it back', async () => {
        await repo.updateReceipt('org_1', 'u_1', 'r_high_1', { reviewedAt: null, reviewedBy: null });
        const s = await repo.summarizeReceipts({ orgId: 'org_1' } as any);
        expect(s.highRiskCount).toBe(2);
    });

    it('reaches zero when every flagged receipt is acknowledged', async () => {
        const now = new Date().toISOString();
        await repo.updateReceipt('org_1', 'u_1', 'r_high_1', { reviewedAt: now, reviewedBy: 'u_1' });
        await repo.updateReceipt('org_1', 'u_1', 'r_high_2', { reviewedAt: now, reviewedBy: 'u_1' });
        const s = await repo.summarizeReceipts({ orgId: 'org_1' } as any);
        expect(s.highRiskCount).toBe(0);
    });

    it('leaves the other totals alone — acknowledging is not archiving', async () => {
        // The alternative was an Archive action, which would have dropped the
        // receipt out of Expenses, deductible totals and GST. It is still an
        // expense; it has just been looked at.
        const s = await repo.summarizeReceipts({ orgId: 'org_1' } as any);
        expect(s.count).toBe(4);
        expect(s.totalAmount).toBe(400);
    });
});

describe('the risk filter', () => {
    it('narrows to one level in the query, not over a page', async () => {
        const page = await repo.listReceiptsPaginated({ orgId: 'org_1', risk: 'HIGH', limit: 50 } as any);
        expect(page.items.map((r: any) => r.receiptId).sort()).toEqual(['r_high_1', 'r_high_2']);
    });

    it('is case insensitive, so a querystring value works as typed', async () => {
        const page = await repo.listReceiptsPaginated({ orgId: 'org_1', risk: 'high', limit: 50 } as any);
        expect(page.items).toHaveLength(2);
    });

    it('can exclude the ones already acknowledged', async () => {
        // Self-contained: an earlier test leaves both acknowledged, and a test
        // that depends on the one before it is a test that lies later.
        await repo.updateReceipt('org_1', 'u_1', 'r_high_1', { reviewedAt: new Date().toISOString() });
        await repo.updateReceipt('org_1', 'u_1', 'r_high_2', { reviewedAt: null });
        const page = await repo.listReceiptsPaginated({ orgId: 'org_1', risk: 'HIGH', unreviewedOnly: true, limit: 50 } as any);
        expect(page.items.map((r: any) => r.receiptId)).toEqual(['r_high_2']);
        // …and without the flag, the acknowledged one is still findable.
        const all = await repo.listReceiptsPaginated({ orgId: 'org_1', risk: 'HIGH', limit: 50 } as any);
        expect(all.items).toHaveLength(2);
        await repo.updateReceipt('org_1', 'u_1', 'r_high_1', { reviewedAt: null });
    });

    it('is a no-op when no risk is asked for', async () => {
        const page = await repo.listReceiptsPaginated({ orgId: 'org_1', limit: 50 } as any);
        expect(page.items).toHaveLength(4);
    });
});
