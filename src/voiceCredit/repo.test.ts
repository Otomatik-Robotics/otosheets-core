import { describe, it, expect, beforeEach } from 'vitest';
import { VoiceCreditRepo } from './repo';
import type { IDdb } from '../ddbPort';

/**
 * In-memory IDdb stub honouring the bits VoiceCreditRepo relies on: a
 * transactWrite that enforces `attribute_not_exists(sk)` on the ledger marker
 * (throwing a TransactionCanceledException on a duplicate, like DynamoDB) and an
 * atomic `ADD balanceCents` update.
 */
function makeStubDdb() {
    const store = new Map<string, any>();
    const k = (orgId: string, sk: string) => `${orgId}|${sk}`;

    const applyUpdate = (key: any, params: any) => {
        const cur = store.get(k(key.orgId, key.sk)) ?? { orgId: key.orgId, sk: key.sk };
        const expr: string = params.UpdateExpression;
        const vals = params.ExpressionAttributeValues ?? {};
        const addMatch = expr.match(/ADD\s+balanceCents\s+(:\w+)/);
        if (addMatch) {
            cur.balanceCents = (cur.balanceCents ?? 0) + vals[addMatch[1]];
        }
        const setMatch = expr.match(/SET\s+(.*)$/);
        if (setMatch) {
            // Split on top-level commas only (if_not_exists(a, :b) has an inner comma).
            const assigns = setMatch[1].match(/(?:[^,(]|\([^)]*\))+/g) ?? [];
            for (const assign of assigns) {
                const [lhs, rhs] = assign.split('=').map((s) => s.trim());
                const ine = rhs.match(/if_not_exists\((\w+),\s*(:\w+)\)/);
                if (ine) {
                    cur[lhs] = cur[lhs] ?? vals[ine[2]];
                } else {
                    cur[lhs] = vals[rhs];
                }
            }
        }
        store.set(k(key.orgId, key.sk), cur);
    };

    const ddb = {
        async getItem(_t: string, key: any) {
            return { Item: store.get(k(key.orgId, key.sk)) };
        },
        async query(params: any) {
            const orgId = params.ExpressionAttributeValues[':orgId'];
            const prefix = params.ExpressionAttributeValues[':prefix'];
            let items = [...store.values()].filter((i) => i.orgId === orgId && String(i.sk).startsWith(prefix));
            items.sort((a, b) => String(b.sk).localeCompare(String(a.sk)));
            if (params.ScanIndexForward === true) items.reverse();
            if (params.Limit) items = items.slice(0, params.Limit);
            return { Items: items };
        },
        async transactWrite(items: any[]) {
            // Phase 1: validate every condition before mutating anything.
            const reasons = items.map((it) => {
                if (it.Put?.ConditionExpression === 'attribute_not_exists(sk)') {
                    const exists = store.has(k(it.Put.Item.orgId, it.Put.Item.sk));
                    return exists ? { Code: 'ConditionalCheckFailed' } : { Code: 'None' };
                }
                return { Code: 'None' };
            });
            if (reasons.some((r) => r.Code === 'ConditionalCheckFailed')) {
                const err: any = new Error('Transaction cancelled');
                err.name = 'TransactionCanceledException';
                err.CancellationReasons = reasons;
                throw err;
            }
            // Phase 2: apply.
            for (const it of items) {
                if (it.Put) store.set(k(it.Put.Item.orgId, it.Put.Item.sk), { ...it.Put.Item });
                if (it.Update) applyUpdate(it.Update.Key, it.Update);
            }
            return {};
        },
    };
    return { ddb: ddb as unknown as IDdb, store };
}

describe('VoiceCreditRepo', () => {
    let repo: VoiceCreditRepo;

    beforeEach(() => {
        repo = new VoiceCreditRepo(makeStubDdb().ddb);
    });

    it('getBalance defaults to 0', async () => {
        expect(await repo.getBalance('org1')).toBe(0);
    });

    it('credit adds to the balance and records a ledger entry', async () => {
        const after = await repo.credit('org1', 2500, { stripeSessionId: 'cs_1' });
        expect(after).toBe(2500);
        const ledger = await repo.listLedger('org1');
        expect(ledger).toHaveLength(1);
        expect(ledger[0]).toMatchObject({ type: 'topup', amountCents: 2500, stripeSessionId: 'cs_1' });
    });

    it('credit is idempotent on stripeSessionId (webhook replay)', async () => {
        await repo.credit('org1', 2500, { stripeSessionId: 'cs_1' });
        const after = await repo.credit('org1', 2500, { stripeSessionId: 'cs_1' });
        expect(after).toBe(2500); // not 5000
        expect(await repo.listLedger('org1')).toHaveLength(1);
    });

    it('debit subtracts a call charge and is idempotent on callId', async () => {
        await repo.credit('org1', 1000, { stripeSessionId: 'cs_1' });
        const after = await repo.debit('org1', 200, { callId: 'call_1' });
        expect(after).toBe(800);
        // /outcome retry must not double-charge.
        const again = await repo.debit('org1', 200, { callId: 'call_1' });
        expect(again).toBe(800);
        const ledger = await repo.listLedger('org1');
        const debits = ledger.filter((l) => l.type === 'debit');
        expect(debits).toHaveLength(1);
        expect(debits[0].amountCents).toBe(-200);
    });

    it('debit with a non-positive amount is a no-op', async () => {
        await repo.credit('org1', 1000, { stripeSessionId: 'cs_1' });
        expect(await repo.debit('org1', 0, { callId: 'call_x' })).toBe(1000);
    });

    it('separate calls each debit once', async () => {
        await repo.credit('org1', 1000, { stripeSessionId: 'cs_1' });
        await repo.debit('org1', 200, { callId: 'call_1' });
        await repo.debit('org1', 300, { callId: 'call_2' });
        expect(await repo.getBalance('org1')).toBe(500);
    });

    it('grants the monthly allowance into the balance and records it', async () => {
        const after = await repo.grantMonthlyAllowance('org1', '2026-06', 2000);
        expect(after).toBe(2000);
        expect(await repo.getPeriodGrant('org1', '2026-06')).toBe(2000);
        const grants = (await repo.listLedger('org1')).filter((l) => l.type === 'grant');
        expect(grants).toHaveLength(1);
        expect(grants[0]).toMatchObject({ amountCents: 2000, period: '2026-06' });
    });

    it('is idempotent per period (re-running the same month does not double-grant)', async () => {
        await repo.grantMonthlyAllowance('org1', '2026-06', 2000);
        const again = await repo.grantMonthlyAllowance('org1', '2026-06', 2000);
        expect(again).toBe(2000); // not 4000
    });

    it('re-grants when the billing period changes (allowance resets)', async () => {
        await repo.grantMonthlyAllowance('org1', '2026-06', 2000);
        await repo.debit('org1', 500, { callId: 'c1' }); // used some
        const afterJuly = await repo.grantMonthlyAllowance('org1', '2026-07', 2000);
        // 2000 (Jun) - 500 (used) + 2000 (Jul) = 3500
        expect(afterJuly).toBe(3500);
        expect(await repo.getPeriodGrant('org1', '2026-07')).toBe(2000);
    });

    it('a zero allowance (e.g. free tier) is a no-op', async () => {
        expect(await repo.grantMonthlyAllowance('org1', '2026-06', 0)).toBe(0);
        expect(await repo.getPeriodGrant('org1', '2026-06')).toBe(0);
    });
});
