import { describe, it, expect, beforeEach } from 'vitest';
import { UsageRepo } from './repo';
import { currentUsageMonth, USAGE_METRIC } from './schema';
import { AI_TASK_CLASSES, creditMetric } from '../limits/aiCredits';
import type { IDdb } from '../ddbPort';

// In-memory IDdb stub supporting the ADD + SET (with if_not_exists) update
// expression the UsageRepo emits for atomic counter increments.
function makeStubDdb() {
    const store = new Map<string, any>();
    // Every call is recorded so tests can assert *how* a counter was written
    // (one atomic ADD, no read first), not just the resulting numbers.
    const calls = {
        getItem: [] as any[],
        update: [] as any[],
        transactWrite: [] as any[],
    };
    const resolveName = (token: string, names: Record<string, string> = {}) =>
        token.startsWith('#') ? names[token] : token;
    // Split on commas that are NOT inside parentheses (if_not_exists(a, b)).
    const splitTopLevel = (s: string) => {
        const out: string[] = [];
        let depth = 0, start = 0;
        for (let i = 0; i < s.length; i++) {
            if (s[i] === '(') depth++;
            else if (s[i] === ')') depth--;
            else if (s[i] === ',' && depth === 0) {
                out.push(s.slice(start, i));
                start = i + 1;
            }
        }
        out.push(s.slice(start));
        return out;
    };

    // Applies one ADD + SET update expression to the store, returning the
    // attributes an `UPDATED_NEW` response would carry.
    const applyUpdate = (key: any, params: any) => {
        const k = `${key.orgId}|${key.sk}`;
        const item = store.get(k) ?? { orgId: key.orgId, sk: key.sk };
        const names = params.ExpressionAttributeNames ?? {};
        const values = params.ExpressionAttributeValues ?? {};
        const expr: string = params.UpdateExpression;
        const touched: Record<string, any> = {};

        const addMatch = expr.match(/ADD (.+?)(?: SET |$)/)?.[1];
        const setMatch = expr.match(/SET (.+)$/)?.[1];

        if (addMatch) {
            for (const clause of splitTopLevel(addMatch)) {
                const [attrTok, valTok] = clause.trim().split(/\s+/);
                const attr = resolveName(attrTok, names);
                item[attr] = (item[attr] ?? 0) + values[valTok];
                touched[attr] = item[attr];
            }
        }
        if (setMatch) {
            for (const clause of splitTopLevel(setMatch)) {
                const [lhs, rhsRaw] = clause.split('=').map((s) => s.trim());
                const attr = resolveName(lhs, names);
                const fn = rhsRaw.match(/if_not_exists\(\s*(\S+)\s*,\s*(\S+)\s*\)/);
                if (fn) {
                    const existingAttr = resolveName(fn[1], names);
                    item[attr] = item[existingAttr] ?? values[fn[2]];
                } else {
                    item[attr] = values[rhsRaw];
                }
                touched[attr] = item[attr];
            }
        }
        store.set(k, item);
        return touched;
    };

    // The real DynamoDB error shape for a cancelled conditional transaction.
    const transactionCancelled = () =>
        Object.assign(new Error('Transaction cancelled'), {
            name: 'TransactionCanceledException',
            CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
        });

    const ddb = {
        async getItem(_t: string, key: any, options?: any) {
            calls.getItem.push({ ...key, ...(options ?? {}) });
            return { Item: store.get(`${key.orgId}|${key.sk}`) };
        },
        async update(_t: string, key: any, params: any) {
            calls.update.push({ key, params });
            const touched = applyUpdate(key, params);
            return params.ReturnValues === 'UPDATED_NEW' ? { Attributes: touched } : {};
        },
        async transactWrite(items: any[]) {
            calls.transactWrite.push(items);
            // All-or-nothing: every ConditionExpression is checked before any
            // write lands, exactly as DynamoDB does it.
            for (const it of items) {
                if (it.Put?.ConditionExpression === 'attribute_not_exists(sk)') {
                    const k = `${it.Put.Item.orgId}|${it.Put.Item.sk}`;
                    if (store.has(k)) throw transactionCancelled();
                }
            }
            for (const it of items) {
                if (it.Put) store.set(`${it.Put.Item.orgId}|${it.Put.Item.sk}`, { ...it.Put.Item });
                if (it.Update) applyUpdate(it.Update.Key, it.Update);
            }
            return {};
        },
    };
    return { ddb: ddb as unknown as IDdb, store, calls };
}

describe('UsageRepo', () => {
    let repo: UsageRepo;
    let stub: ReturnType<typeof makeStubDdb>;

    beforeEach(() => {
        stub = makeStubDdb();
        repo = new UsageRepo(stub.ddb);
    });

    it('returns null for an untouched meter', async () => {
        expect(await repo.getChatTokens('org1', '2026-06')).toBeNull();
    });

    it('creates a meter on first increment with createdAt + ttl', async () => {
        await repo.incrementChatTokens('org1', { input: 100, output: 40 }, '2026-06');
        const row = await repo.getChatTokens('org1', '2026-06');
        expect(row).toMatchObject({
            orgId: 'org1',
            metric: 'chatTokens',
            month: '2026-06',
            inputTokens: 100,
            outputTokens: 40,
            totalTokens: 140,
        });
        expect(row?.createdAt).toBeTruthy();
        expect(row?.ttl).toBeGreaterThan(0);
    });

    it('accumulates tokens atomically across turns', async () => {
        await repo.incrementChatTokens('org1', { input: 100, output: 40 }, '2026-06');
        const firstTtl = (await repo.getChatTokens('org1', '2026-06'))!.ttl;
        await repo.incrementChatTokens('org1', { input: 10, output: 5 }, '2026-06');
        const row = await repo.getChatTokens('org1', '2026-06');
        expect(row).toMatchObject({ inputTokens: 110, outputTokens: 45, totalTokens: 155 });
        // ttl set once and preserved across increments
        expect(row?.ttl).toBe(firstTtl);
    });

    it('keeps months and orgs isolated', async () => {
        await repo.incrementChatTokens('org1', { input: 100, output: 0 }, '2026-06');
        await repo.incrementChatTokens('org1', { input: 7, output: 0 }, '2026-07');
        await repo.incrementChatTokens('org2', { input: 999, output: 0 }, '2026-06');
        expect((await repo.getChatTokens('org1', '2026-06'))!.totalTokens).toBe(100);
        expect((await repo.getChatTokens('org1', '2026-07'))!.totalTokens).toBe(7);
        expect((await repo.getChatTokens('org2', '2026-06'))!.totalTokens).toBe(999);
    });

    it('currentUsageMonth formats as YYYY-MM', () => {
        expect(currentUsageMonth(new Date('2026-06-13T10:00:00Z'))).toBe('2026-06');
    });

    // ── AI credit meters ────────────────────────────────────────────────
    describe('credits', () => {
        it('writes with a single atomic ADD and never reads first', async () => {
            await repo.incrementCredits(
                'org1',
                'assistant',
                { credits: 900, input: 400, output: 100 },
                '2026-06',
            );

            // Read-modify-write would show up here as a getItem before the update.
            expect(stub.calls.getItem).toHaveLength(0);
            expect(stub.calls.update).toHaveLength(1);

            const expr: string = stub.calls.update[0].params.UpdateExpression;
            expect(expr).toContain('ADD credits :c');
            expect(expr).toContain('cacheReadTokens :cr');
            // Counters are ADDed, never SET to a caller-computed total.
            expect(expr.slice(expr.indexOf('SET '))).not.toContain('credits =');
        });

        it('keys the meter as USAGE#credits:<class>#<month>', async () => {
            await repo.incrementCredits('org1', 'design', { credits: 10 }, '2026-06');
            expect(stub.calls.update[0].key).toEqual({
                orgId: 'org1',
                sk: 'USAGE#credits:design#2026-06',
            });
            expect([...stub.store.keys()]).toEqual(['org1|USAGE#credits:design#2026-06']);
        });

        it('creates the meter on first write with metric, createdAt and ttl', async () => {
            await repo.incrementCredits(
                'org1',
                'design',
                { credits: 5000, input: 1000, output: 800, cacheRead: 2000, cacheWrite: 500 },
                '2026-06',
            );
            const row = await repo.getCredits('org1', 'design', '2026-06');
            expect(row).toMatchObject({
                orgId: 'org1',
                metric: 'credits:design',
                month: '2026-06',
                credits: 5000,
                inputTokens: 1000,
                outputTokens: 800,
                cacheReadTokens: 2000,
                cacheWriteTokens: 500,
                // totalTokens is the raw token count: input + output + cache read + write
                totalTokens: 4300,
            });
            expect(row?.createdAt).toBeTruthy();
            expect(row?.ttl).toBeGreaterThan(0);
        });

        it('accumulates credits across turns and keeps ttl fixed', async () => {
            await repo.incrementCredits(
                'org1',
                'assistant',
                { credits: 900, input: 400, output: 100 },
                '2026-06',
            );
            const firstTtl = (await repo.getCredits('org1', 'assistant', '2026-06'))!.ttl;
            await repo.incrementCredits(
                'org1',
                'assistant',
                { credits: 60, input: 10, output: 10, cacheRead: 300 },
                '2026-06',
            );
            const row = await repo.getCredits('org1', 'assistant', '2026-06');
            expect(row).toMatchObject({
                credits: 960,
                inputTokens: 410,
                outputTokens: 110,
                cacheReadTokens: 300,
                cacheWriteTokens: 0,
                // (400+100) + (10+10+300)
                totalTokens: 820,
            });
            expect(row?.ttl).toBe(firstTtl);
        });

        it('never writes a fractional credit to DynamoDB', async () => {
            await repo.incrementCredits('org1', 'bulk', { credits: 12.6 }, '2026-06');
            const written = stub.calls.update[0].params.ExpressionAttributeValues[':c'];
            expect(Number.isInteger(written)).toBe(true);
            expect(written).toBe(13);
        });

        it('never writes NaN, Infinity or a negative into a counter', async () => {
            // A malformed provider usage report must cost the meter nothing —
            // DynamoDB throws on NaN/Infinity, and a negative would permanently
            // corrupt the month's total.
            await repo.incrementCredits(
                'org1',
                'assistant',
                { credits: NaN, input: Infinity, output: -900, cacheRead: undefined } as any,
                '2026-06',
            );
            const values = stub.calls.update[0].params.ExpressionAttributeValues;
            for (const token of [':c', ':i', ':o', ':cr', ':cw', ':t']) {
                expect(Number.isInteger(values[token])).toBe(true);
                expect(values[token]).toBeGreaterThanOrEqual(0);
            }
            expect((await repo.getCredits('org1', 'assistant', '2026-06'))!.credits).toBe(0);
        });

        it('clamps an absurd magnitude instead of throwing or locking the org out', async () => {
            // DynamoDB's marshaller throws above Number.MAX_SAFE_INTEGER (the
            // turn would then meter as nothing), and a mis-mapped field — a ms
            // timestamp landing in a token count — would permanently add ~1.7e12
            // to a month that has no compensating write.
            await repo.incrementCredits(
                'org1',
                'assistant',
                { credits: 1e21, input: Date.now() * 1000 },
                '2026-06',
            );
            const values = stub.calls.update[0].params.ExpressionAttributeValues;
            for (const token of [':c', ':i', ':o', ':cr', ':cw', ':t']) {
                expect(Number.isSafeInteger(values[token])).toBe(true);
                expect(values[token]).toBeLessThanOrEqual(1e12);
            }
        });

        it('never rounds a sub-1 credit down to free (matches creditsFor)', async () => {
            // creditsFor floors a billable turn at 1 credit precisely so a long
            // tail of tiny cached turns cannot each meter as zero; the write
            // seam must not reintroduce that blind spot.
            await repo.incrementCredits('org1', 'assistant', { credits: 0.4 }, '2026-06');
            expect((await repo.getCredits('org1', 'assistant', '2026-06'))!.credits).toBe(1);
        });

        it('a cache-heavy turn can never be recorded as zero credits', async () => {
            // The blind spot the feature exists to close: a caller that maps the
            // tokens but computes credits the old way (input + output) hands
            // over credits: 0 for a fully cached turn. Derive from the
            // breakdown rather than book it as free.
            const totals = await repo.incrementCredits(
                'org1',
                'assistant',
                { credits: 0, cacheRead: 200_000 },
                '2026-06',
            );
            expect(totals.credits).toBe(20_000); // 200_000 * 0.1
            expect((await repo.getCredits('org1', 'assistant', '2026-06'))!.credits).toBe(20_000);
        });

        it('rejects a mis-mapped delta rather than writing a silent zero', async () => {
            // RawTokenUsage shares no field name with CreditDelta, so passing
            // one through `as any` would coerce every field to 0 and write a
            // legitimate-looking free turn.
            await expect(
                repo.incrementCredits(
                    'org1',
                    'assistant',
                    { inputTokens: 5_000, outputTokens: 900 } as any,
                    '2026-06',
                ),
            ).rejects.toThrow(/unrecognised delta shape/);
            expect(stub.calls.update).toHaveLength(0);
        });

        it('returns the authoritative post-write totals — no second read needed', async () => {
            const first = await repo.incrementCredits(
                'org1',
                'design',
                { credits: 9_500, input: 2_000, output: 500 },
                '2026-06',
            );
            expect(first).toEqual({ credits: 9_500, totalTokens: 2_500 });
            const second = await repo.incrementCredits(
                'org1',
                'design',
                { credits: 500, input: 100 },
                '2026-06',
            );
            expect(second).toEqual({ credits: 10_000, totalTokens: 2_600 });
            // The totals came off the update itself, not a follow-up getItem.
            expect(stub.calls.getItem).toHaveLength(0);
            expect(stub.calls.update[0].params.ReturnValues).toBe('UPDATED_NEW');
        });

        it('a poisoned delta cannot claw back credits already metered', async () => {
            await repo.incrementCredits('org1', 'assistant', { credits: 500 }, '2026-06');
            await repo.incrementCredits('org1', 'assistant', { credits: -400 }, '2026-06');
            expect((await repo.getCredits('org1', 'assistant', '2026-06'))!.credits).toBe(500);
        });

        it('returns null for an untouched credit meter', async () => {
            expect(await repo.getCredits('org1', 'bulk', '2026-06')).toBeNull();
        });

        it('keeps task classes, months and orgs isolated', async () => {
            await repo.incrementCredits('org1', 'assistant', { credits: 100 }, '2026-06');
            await repo.incrementCredits('org1', 'design', { credits: 7 }, '2026-06');
            await repo.incrementCredits('org1', 'assistant', { credits: 5 }, '2026-07');
            await repo.incrementCredits('org2', 'assistant', { credits: 999 }, '2026-06');

            expect((await repo.getCredits('org1', 'assistant', '2026-06'))!.credits).toBe(100);
            expect((await repo.getCredits('org1', 'design', '2026-06'))!.credits).toBe(7);
            expect((await repo.getCredits('org1', 'assistant', '2026-07'))!.credits).toBe(5);
            expect((await repo.getCredits('org2', 'assistant', '2026-06'))!.credits).toBe(999);
        });

        it('defaults to the current usage month', async () => {
            await repo.incrementCredits('org1', 'assistant', { credits: 42 });
            expect(stub.calls.update[0].key.sk)
                .toBe(`USAGE#credits:assistant#${currentUsageMonth()}`);
            expect((await repo.getCredits('org1', 'assistant'))!.credits).toBe(42);
        });
    });

    // ── Replay safety (every trigger we use is at-least-once) ───────────
    describe('turnId idempotency', () => {
        it('a replayed turn is a no-op, not a double charge', async () => {
            const delta = { credits: 9_500, input: 2_000, output: 500, turnId: 'run_abc#1' };
            const first = await repo.incrementCredits('org1', 'assistant', delta, '2026-06');
            // Same turn re-metered: SDK retry after a lost response, Lambda
            // async retry, or the SSE reconnect replay.
            const replay = await repo.incrementCredits('org1', 'assistant', delta, '2026-06');

            expect(first.credits).toBe(9_500);
            expect(replay.credits).toBe(9_500);
            expect((await repo.getCredits('org1', 'assistant', '2026-06'))!.credits).toBe(9_500);
            expect((await repo.getCredits('org1', 'assistant', '2026-06'))!.totalTokens).toBe(2_500);
        });

        it('writes the counter and the dedupe marker in one transaction', async () => {
            await repo.incrementCredits(
                'org1',
                'design',
                { credits: 100, turnId: 'run_xyz' },
                '2026-06',
            );
            const items = stub.calls.transactWrite[0];
            expect(items).toHaveLength(2);
            expect(items[0].Put.ConditionExpression).toBe('attribute_not_exists(sk)');
            expect(items[0].Put.Item.sk).toBe('USAGE#turn#credits:design#run_xyz');
            // The marker expires long before the monthly bucket does.
            expect(items[0].Put.Item.ttl).toBeLessThan(items[1].Update.ExpressionAttributeValues[':ttl']);
            expect(items[1].Update.UpdateExpression).toContain('ADD credits :c');
            // Still one atomic ADD — never a read-modify-write.
            expect(items[1].Update.UpdateExpression).not.toContain('credits =');
        });

        it('distinct turns still accumulate', async () => {
            await repo.incrementCredits('org1', 'bulk', { credits: 10, turnId: 't1' }, '2026-06');
            await repo.incrementCredits('org1', 'bulk', { credits: 20, turnId: 't2' }, '2026-06');
            expect((await repo.getCredits('org1', 'bulk', '2026-06'))!.credits).toBe(30);
        });

        it('the same turnId on a different class is a different turn', async () => {
            await repo.incrementCredits('org1', 'bulk', { credits: 10, turnId: 't1' }, '2026-06');
            await repo.incrementCredits('org1', 'design', { credits: 10, turnId: 't1' }, '2026-06');
            expect((await repo.getCredits('org1', 'bulk', '2026-06'))!.credits).toBe(10);
            expect((await repo.getCredits('org1', 'design', '2026-06'))!.credits).toBe(10);
        });

        it('the marker is not month-scoped, so a replay across midnight on the 1st is still a no-op', async () => {
            // A turn metered at 23:59:59 on the last day of the month and
            // retried a second later recomputes currentUsageMonth() to the new
            // bucket. A month-scoped marker would miss that and double-charge —
            // and because the counters reject negatives, an over-count can
            // never be undone. Suppressing is the recoverable direction.
            await repo.incrementCredits('org1', 'bulk', { credits: 10, turnId: 't1' }, '2026-06');
            await repo.incrementCredits('org1', 'bulk', { credits: 10, turnId: 't1' }, '2026-07');
            expect((await repo.getCredits('org1', 'bulk', '2026-06'))!.credits).toBe(10);
            expect(await repo.getCredits('org1', 'bulk', '2026-07')).toBeNull();
        });

        it('org scoping: the same turnId under another org is metered independently', async () => {
            await repo.incrementCredits('org1', 'bulk', { credits: 10, turnId: 't1' }, '2026-06');
            await repo.incrementCredits('org2', 'bulk', { credits: 10, turnId: 't1' }, '2026-06');
            expect((await repo.getCredits('org1', 'bulk', '2026-06'))!.credits).toBe(10);
            expect((await repo.getCredits('org2', 'bulk', '2026-06'))!.credits).toBe(10);
        });

        it('reads the meter back strongly consistently after a transacted write', async () => {
            await repo.incrementCredits('org1', 'bulk', { credits: 10, turnId: 't1' }, '2026-06');
            expect(stub.calls.getItem).toHaveLength(1);
            expect(stub.calls.getItem[0].ConsistentRead).toBe(true);
        });

        it('rethrows a transaction failure that is not a duplicate', async () => {
            const boom = Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' });
            (stub.ddb as any).transactWrite = async () => { throw boom; };
            await expect(
                repo.incrementCredits('org1', 'bulk', { credits: 10, turnId: 't1' }, '2026-06'),
            ).rejects.toThrow('throttled');
        });
    });

    describe('meterAiTurn', () => {
        it('derives credits and the breakdown from one usage report', async () => {
            const totals = await repo.meterAiTurn(
                'org1',
                'design',
                {
                    inputTokens: 2_000,
                    outputTokens: 500,
                    cacheReadInputTokens: 40_000,
                    cacheWriteInputTokens: 800,
                },
                { tier: 'pro', month: '2026-06' },
            );
            // 2000*1 + 500*5 + 40000*0.1 + 800*1.25
            expect(totals.credits).toBe(9_500);
            const row = await repo.getCredits('org1', 'design', '2026-06');
            expect(row).toMatchObject({
                credits: 9_500,
                inputTokens: 2_000,
                outputTokens: 500,
                cacheReadTokens: 40_000,
                cacheWriteTokens: 800,
                totalTokens: 43_300,
            });
        });

        it('meters a fully cached turn — the report the old counter saw as free', async () => {
            const totals = await repo.meterAiTurn(
                'org1',
                'assistant',
                { cacheReadInputTokens: 200_000 },
                { month: '2026-06' },
            );
            expect(totals.credits).toBe(20_000);
        });

        it('is replay-safe when given a turnId', async () => {
            const usage = { inputTokens: 1_000, outputTokens: 200 };
            await repo.meterAiTurn('org1', 'assistant', usage, { turnId: 'run_1', month: '2026-06' });
            await repo.meterAiTurn('org1', 'assistant', usage, { turnId: 'run_1', month: '2026-06' });
            expect((await repo.getCredits('org1', 'assistant', '2026-06'))!.credits).toBe(2_000);
        });

        it('writes nothing for an empty or malformed usage report', async () => {
            const totals = await repo.meterAiTurn('org1', 'bulk', {}, { month: '2026-06' });
            expect(totals).toEqual({ credits: 0, totalTokens: 0 });
            await repo.meterAiTurn('org1', 'bulk', { inputTokens: NaN } as any, { month: '2026-06' });
            expect(stub.calls.update).toHaveLength(0);
            expect(stub.calls.transactWrite).toHaveLength(0);
        });
    });

    describe('getAllCredits', () => {
        it('covers every task class and reports 0 for untouched meters', async () => {
            await repo.incrementCredits('org1', 'design', { credits: 250 }, '2026-06');

            const totals = await repo.getAllCredits('org1', '2026-06');
            expect(Object.keys(totals).sort()).toEqual([...AI_TASK_CLASSES].sort());
            expect(totals).toEqual({ assistant: 0, design: 250, bulk: 0 });
            // 0, not undefined — callers subtract these from a budget directly.
            for (const taskClass of AI_TASK_CLASSES) {
                expect(typeof totals[taskClass]).toBe('number');
            }
        });

        it('reads exactly one meter per class', async () => {
            await repo.getAllCredits('org1', '2026-06');
            expect(stub.calls.getItem).toHaveLength(AI_TASK_CLASSES.length);
            expect(stub.calls.getItem.map((k: any) => k.sk)).toEqual(
                AI_TASK_CLASSES.map((c) => `USAGE#credits:${c}#2026-06`),
            );
        });

        it('is all zeros for an org that has never used AI', async () => {
            expect(await repo.getAllCredits('brand-new-org', '2026-06'))
                .toEqual({ assistant: 0, design: 0, bulk: 0 });
        });

        it('defaults to the current usage month', async () => {
            await repo.incrementCredits('org1', 'bulk', { credits: 11 });
            expect(await repo.getAllCredits('org1')).toEqual({
                assistant: 0, design: 0, bulk: 11,
            });
        });
    });

    // ── Back-compat: the chatTokens meter must be untouched ─────────────
    describe('back-compat with the chatTokens meter', () => {
        it('incrementChatTokens still writes the legacy shape and key', async () => {
            await repo.incrementChatTokens('org1', { input: 100, output: 40 }, '2026-06');

            expect(stub.calls.getItem).toHaveLength(0);
            expect(stub.calls.update[0].key).toEqual({
                orgId: 'org1',
                sk: 'USAGE#chatTokens#2026-06',
            });
            const expr: string = stub.calls.update[0].params.UpdateExpression;
            expect(expr.startsWith('ADD inputTokens :i, outputTokens :o, totalTokens :t ')).toBe(true);
            // totalTokens on the legacy meter stays input + output — no cache terms.
            expect(stub.calls.update[0].params.ExpressionAttributeValues[':t']).toBe(140);
            expect(expr).not.toContain('cacheReadTokens');
            expect(expr).not.toContain('credits');

            const row = await repo.getChatTokens('org1', '2026-06');
            expect(row).toMatchObject({
                metric: 'chatTokens',
                inputTokens: 100,
                outputTokens: 40,
                totalTokens: 140,
            });
        });

        it('credit writes do not touch the chat-token meter, or vice versa', async () => {
            await repo.incrementChatTokens('org1', { input: 100, output: 40 }, '2026-06');
            await repo.incrementCredits(
                'org1',
                'assistant',
                { credits: 300, input: 100, output: 40 },
                '2026-06',
            );

            expect((await repo.getChatTokens('org1', '2026-06'))!.totalTokens).toBe(140);
            // A chatTokens row carries no `credits` attribute, but `UsageRecord`
            // types it as a required number — so the read normalises it to 0
            // rather than handing back `undefined` behind that type. A gate
            // written `row.credits >= budget` must compare numbers, not
            // evaluate `undefined >= n` → false and silently fail open.
            expect((await repo.getChatTokens('org1', '2026-06'))!.credits).toBe(0);
            expect((await repo.getCredits('org1', 'assistant', '2026-06'))!.credits).toBe(300);
            expect(await repo.getAllCredits('org1', '2026-06'))
                .toEqual({ assistant: 300, design: 0, bulk: 0 });
        });

        it('the generic increment() is unchanged for arbitrary metrics', async () => {
            await repo.increment('org1', 'chatTokens', '2026-06', { input: 5 });
            await repo.increment('org1', 'chatTokens', '2026-06', { output: 5 });
            expect(await repo.getMonth('org1', 'chatTokens', '2026-06')).toMatchObject({
                inputTokens: 5, outputTokens: 5, totalTokens: 10,
            });
        });

        it('the legacy meter guards NaN, Infinity and negatives too', async () => {
            // This is the meter enforcing the live chat-token budget, and it is
            // fed from the same untrusted provider usage report. A NaN would
            // throw the marshaller (turn metered as nothing); a negative would
            // permanently claw back the month's total.
            await repo.incrementChatTokens('org1', { input: 100, output: 40 }, '2026-06');
            await repo.incrementChatTokens('org1', { input: NaN, output: -900 } as any, '2026-06');
            await repo.incrementChatTokens('org1', { input: Infinity } as any, '2026-06');

            const row = await repo.getChatTokens('org1', '2026-06');
            expect(row).toMatchObject({ inputTokens: 100, outputTokens: 40, totalTokens: 140 });
            for (const call of stub.calls.update) {
                for (const token of [':i', ':o', ':t']) {
                    const v = call.params.ExpressionAttributeValues[token];
                    expect(Number.isSafeInteger(v)).toBe(true);
                    expect(v).toBeGreaterThanOrEqual(0);
                }
            }
        });

        it('increment() refuses to write a credit meter it cannot count', async () => {
            // It has no `ADD credits` clause, so it would bump the credit row's
            // raw tokens while leaving `credits` absent — the class would read
            // 0 forever and be effectively free.
            for (const metric of [
                USAGE_METRIC.CREDITS_ASSISTANT,
                USAGE_METRIC.CREDITS_DESIGN,
                USAGE_METRIC.CREDITS_BULK,
            ]) {
                await expect(
                    repo.increment('org1', metric, '2026-06', { input: 100 }),
                ).rejects.toThrow(/incrementCredits/);
            }
            expect(stub.calls.update).toHaveLength(0);
        });
    });

    it('USAGE_METRIC credit names match creditMetric()', () => {
        expect(USAGE_METRIC.CREDITS_ASSISTANT).toBe(creditMetric('assistant'));
        expect(USAGE_METRIC.CREDITS_DESIGN).toBe(creditMetric('design'));
        expect(USAGE_METRIC.CREDITS_BULK).toBe(creditMetric('bulk'));
        expect(USAGE_METRIC.CHAT_TOKENS).toBe('chatTokens');
    });
});
