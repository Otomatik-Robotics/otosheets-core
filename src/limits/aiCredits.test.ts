import { describe, it, expect } from 'vitest';
import {
    AI_TASK_CLASSES,
    AI_MODELS,
    CREDIT_BUDGET,
    CREDIT_WEIGHTS,
    creditBudget,
    creditMetric,
    creditsFor,
    creditsForSpec,
    creditsForTurn,
    resolveModelSpec,
    totalCreditBudget,
    worstCaseAudCents,
    AI_REVENUE_SHARE,
    AUD_CENTS_PER_MILLION_CREDITS,
    type AiModelSpec,
    type AiTaskClass,
    type RawTokenUsage,
} from './aiCredits';

/** The only Bedrock model id verified to work in this account. */
const VERIFIED_MODEL_ID = 'au.anthropic.claude-haiku-4-5-20251001-v1:0';

/**
 * Price at the baseline model rate. `creditsFor` has no default multiplier on
 * purpose (a default is what lets a repriced model slot go unmetered), so these
 * weighting tests state the baseline explicitly rather than omitting it.
 */
const at = (usage: RawTokenUsage, multiplier: number = 1) => creditsFor(usage, multiplier);

describe('aiCredits — task classes', () => {
    it('exposes exactly the three classes', () => {
        expect([...AI_TASK_CLASSES]).toEqual(['assistant', 'design', 'bulk']);
    });
});

describe('creditsFor — weighting', () => {
    it('weights output at 5x input', () => {
        expect(at({ inputTokens: 1_000 })).toBe(1_000);
        expect(at({ outputTokens: 1_000 })).toBe(5_000);
        expect(at({ outputTokens: 1_000 })).toBe(at({ inputTokens: 1_000 }) * 5);
    });

    it('weights a cache read at 0.1x input and a cache write at 1.25x', () => {
        expect(at({ cacheReadInputTokens: 1_000 })).toBe(100);
        expect(at({ cacheWriteInputTokens: 1_000 })).toBe(1_250);
    });

    it('sums every component of a mixed turn', () => {
        // 2000*1 + 500*5 + 40000*0.1 + 800*1.25 = 2000 + 2500 + 4000 + 1000
        expect(
            at({
                inputTokens: 2_000,
                outputTokens: 500,
                cacheReadInputTokens: 40_000,
                cacheWriteInputTokens: 800,
            }),
        ).toBe(9_500);
    });

    it('the weights are the documented ratios', () => {
        expect(CREDIT_WEIGHTS).toEqual({ input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 });
    });
});

describe('creditsFor — the cache-read blind spot (the bug this fixes)', () => {
    it('a cache-read-only turn is metered, not free', () => {
        // Bedrock bills this turn. The old raw-token counter saw inputTokens=0 and
        // charged nothing, because cache reads are reported in their own field.
        const credits = at({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 200_000 });
        expect(credits).toBe(20_000);
        expect(credits).toBeGreaterThan(0);
    });

    it('a cache-write-only turn is metered too', () => {
        expect(at({ cacheWriteInputTokens: 10_000 })).toBe(12_500);
    });

    it('never rounds a real billable turn down to zero', () => {
        // 1 cache-read token weighs 0.1 credits — Math.round alone would meter 0,
        // so a long tail of tiny cached turns would cost us nothing on paper.
        expect(at({ cacheReadInputTokens: 1 })).toBe(1);
        expect(at({ cacheReadInputTokens: 4 })).toBe(1);
    });
});

describe('creditsFor — hostile input', () => {
    it('treats missing fields and an empty turn as zero', () => {
        expect(at({})).toBe(0);
        expect(at({ inputTokens: undefined, outputTokens: undefined })).toBe(0);
        expect(at({ inputTokens: 0, outputTokens: 0 })).toBe(0);
    });

    it('ignores NaN, Infinity and negative counts instead of poisoning the total', () => {
        const credits = at({
            inputTokens: NaN,
            outputTokens: -500,
            cacheReadInputTokens: Infinity,
            cacheWriteInputTokens: undefined,
        });
        expect(Number.isNaN(credits)).toBe(false);
        expect(credits).toBe(0);
    });

    it('a negative field cannot subtract from a real charge', () => {
        expect(at({ inputTokens: 1_000, outputTokens: -100_000 })).toBe(1_000);
    });

    it('never returns NaN or a negative for any input shape', () => {
        const shapes: any[] = [
            {},
            null,
            undefined,
            { inputTokens: NaN },
            { outputTokens: -1 },
            { inputTokens: '900' },
            { inputTokens: 'not-a-number' },
            { cacheReadInputTokens: -Infinity },
        ];
        for (const shape of shapes) {
            const credits = at(shape);
            expect(Number.isNaN(credits)).toBe(false);
            expect(credits).toBeGreaterThanOrEqual(0);
        }
    });

    it('always returns a whole integer — DynamoDB never sees a fraction', () => {
        const samples: any[] = [
            { cacheReadInputTokens: 333 },
            { cacheReadInputTokens: 7, outputTokens: 3 },
            { cacheWriteInputTokens: 1_111 },
            { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 1, cacheWriteInputTokens: 1 },
        ];
        for (const s of samples) {
            expect(Number.isInteger(at(s))).toBe(true);
        }
        expect(at({ cacheReadInputTokens: 333 })).toBe(33); // 33.3 → 33
    });
});

describe('creditsFor — multiplier (model switching reprices the quota)', () => {
    it('scales the result', () => {
        expect(at({ inputTokens: 1_000 }, 3)).toBe(3_000);
        expect(at({ inputTokens: 1_000 }, 0.5)).toBe(500);
        expect(at({ outputTokens: 1_000 }, 2)).toBe(10_000);
    });

    it('falls back to 1 for a broken multiplier — the meter fails closed, not free', () => {
        expect(at({ inputTokens: 1_000 }, NaN)).toBe(1_000);
        expect(at({ inputTokens: 1_000 }, -2)).toBe(1_000);
        expect(at({ inputTokens: 1_000 }, 0)).toBe(1_000);
        expect(at({ inputTokens: 1_000 }, undefined as any)).toBe(1_000);
    });

    it('a repriced model spec meters more for the identical turn', () => {
        const usage = { inputTokens: 1_000, outputTokens: 200 };
        const baseline = at(usage, AI_MODELS.assistant.multiplier);
        expect(at(usage, AI_MODELS.assistant.multiplier * 4)).toBe(baseline * 4);
    });
});

describe('creditsForSpec / creditsForTurn — repricing reaches the meter', () => {
    const usage = { inputTokens: 1_000, outputTokens: 200 };

    it('takes the multiplier off the spec, so a repriced slot reprices the turn', () => {
        // The regression: the multiplier used to default to 1 and nothing bound
        // it to the resolved spec, so the day a slot moved to a costlier model
        // every call site kept metering at the old rate — silently, with no
        // compile error and no failing test.
        const baseline: AiModelSpec = { ...AI_MODELS.design, multiplier: 1 };
        const repriced: AiModelSpec = { ...AI_MODELS.design, multiplier: 4 };
        expect(creditsForSpec(usage, repriced)).toBe(creditsForSpec(usage, baseline) * 4);
        expect(creditsForSpec(usage, repriced)).toBe(creditsFor(usage, 4));
    });

    it('prices a (tier, class) without the caller resolving the model at all', () => {
        for (const cls of AI_TASK_CLASSES) {
            for (const tier of ['free', 'starter', 'pro', 'bogus', null]) {
                expect(creditsForTurn(usage, tier, cls)).toBe(
                    creditsFor(usage, resolveModelSpec(tier, cls).multiplier),
                );
            }
        }
    });

    it('falls back to the baseline for a missing spec — never free', () => {
        expect(creditsForSpec(usage, null)).toBe(creditsFor(usage, 1));
        expect(creditsForSpec(usage, undefined)).toBe(creditsFor(usage, 1));
        expect(creditsForSpec(usage, { ...AI_MODELS.bulk, multiplier: 0 })).toBe(creditsFor(usage, 1));
    });
});

describe('resolveModelSpec', () => {
    it('gives the design class a 32000-token output ceiling (outage regression guard)', () => {
        expect(resolveModelSpec('pro', 'design').maxOutputTokens).toBe(32000);
        expect(resolveModelSpec('free', 'design').maxOutputTokens).toBe(32000);
        expect(resolveModelSpec(null, 'design').maxOutputTokens).toBe(32000);
    });

    it('caps assistant at 4096 and bulk at 8192', () => {
        expect(resolveModelSpec('starter', 'assistant').maxOutputTokens).toBe(4096);
        expect(resolveModelSpec('starter', 'bulk').maxOutputTokens).toBe(8192);
    });

    it('defaults to the assistant slot for an unknown tier or class', () => {
        expect(resolveModelSpec()).toEqual(AI_MODELS.assistant);
        expect(resolveModelSpec('mystery-tier')).toEqual(AI_MODELS.assistant);
        expect(resolveModelSpec('pro', 'nonsense' as AiTaskClass)).toEqual(AI_MODELS.assistant);
        expect(resolveModelSpec(null, undefined)).toEqual(AI_MODELS.assistant);
    });

    it('only ever hands back the model id verified in this account', () => {
        for (const spec of Object.values(AI_MODELS)) {
            expect(spec.id).toBe(VERIFIED_MODEL_ID);
            expect(spec.multiplier).toBe(1);
            expect(spec.label.length).toBeGreaterThan(0);
        }
        for (const cls of AI_TASK_CLASSES) {
            for (const tier of ['free', 'starter', 'pro', 'bogus', null]) {
                expect(resolveModelSpec(tier, cls).id).toBe(VERIFIED_MODEL_ID);
            }
        }
    });
});

describe('creditBudget', () => {
    // Deliberately NOT nine hardcoded literals. Budgets are derived from tier
    // price x AI_REVENUE_SHARE and are expected to move when pricing or the rate
    // assumption changes; a copy of the table asserts only that the table equals
    // itself, and breaks on every legitimate tuning. The contract worth pinning
    // is that the lookup reads through for every pair. The VALUES are constrained
    // by the margin-guard tests below, which is where a bad number should fail.
    it('reads through to the table for every known (tier, class)', () => {
        for (const tier of ['free', 'starter', 'pro'] as const) {
            for (const cls of AI_TASK_CLASSES) {
                expect(creditBudget(tier, cls)).toBe(CREDIT_BUDGET[tier][cls]);
            }
        }
    });

    it('every budget is a positive integer or the -1 unlimited sentinel', () => {
        for (const tier of ['free', 'starter', 'pro'] as const) {
            for (const cls of AI_TASK_CLASSES) {
                const v = CREDIT_BUDGET[tier][cls];
                expect(Number.isInteger(v)).toBe(true);
                expect(v === -1 || v > 0).toBe(true);
            }
        }
    });

    it('defaults to free + assistant for an unknown tier or class', () => {
        expect(creditBudget()).toBe(CREDIT_BUDGET.free.assistant);
        expect(creditBudget(null)).toBe(CREDIT_BUDGET.free.assistant);
        expect(creditBudget('enterprise')).toBe(CREDIT_BUDGET.free.assistant);
        expect(creditBudget('pro', 'made-up' as AiTaskClass)).toBe(CREDIT_BUDGET.pro.assistant);
        expect(creditBudget('', '' as AiTaskClass)).toBe(CREDIT_BUDGET.free.assistant);
    });

    it('every budget is a whole number, and paid tiers never get less than free', () => {
        for (const cls of AI_TASK_CLASSES) {
            const free = creditBudget('free', cls);
            const starter = creditBudget('starter', cls);
            const pro = creditBudget('pro', cls);
            for (const v of [free, starter, pro]) {
                expect(Number.isInteger(v)).toBe(true);
                expect(v === -1 || v > 0).toBe(true);
            }
            expect(starter).toBeGreaterThanOrEqual(free);
            expect(pro).toBeGreaterThanOrEqual(starter);
        }
    });
});

describe('creditMetric', () => {
    it('matches the USAGE_METRIC string values exactly', () => {
        // These strings are the wire contract with src/usage/schema.ts —
        // USAGE_METRIC.CREDITS_ASSISTANT / _DESIGN / _BULK.
        expect(creditMetric('assistant')).toBe('credits:assistant');
        expect(creditMetric('design')).toBe('credits:design');
        expect(creditMetric('bulk')).toBe('credits:bulk');
    });

    it('produces a distinct metric per class and falls back to assistant', () => {
        const metrics = AI_TASK_CLASSES.map(creditMetric);
        expect(new Set(metrics).size).toBe(AI_TASK_CLASSES.length);
        expect(creditMetric('bogus' as AiTaskClass)).toBe('credits:assistant');
    });

    it('never collides with the legacy chatTokens metric', () => {
        for (const cls of AI_TASK_CLASSES) {
            expect(creditMetric(cls)).not.toBe('chatTokens');
        }
    });
});

// ─── Margin guard ────────────────────────────────────────────────────────────
// CREDIT_BUDGET is derived from tier price x AI_REVENUE_SHARE, not picked. These
// tests exist so a future "just bump the budget a bit" cannot quietly breach the
// margin it was derived from — the previous table had starter at ~9.5% of revenue
// and pro at ~33%, which is exactly the drift this catches.
describe('aiCredits — margin guard', () => {
    /** Published AUD monthly prices: Solo (starter) $49, Crew (pro) $220 (5 seats). */
    const MONTHLY_AUD: Record<string, number> = { starter: 49, pro: 220 };

    it('no paid tier can spend more than AI_REVENUE_SHARE of its revenue', () => {
        for (const [tier, price] of Object.entries(MONTHLY_AUD)) {
            const share = worstCaseAudCents(tier) / 100 / price;
            expect(share).toBeLessThanOrEqual(AI_REVENUE_SHARE);
        }
    });

    it('paid tiers carry comparable margin exposure, not wildly different ones', () => {
        const shares = Object.entries(MONTHLY_AUD)
            .map(([tier, price]) => worstCaseAudCents(tier) / 100 / price);
        expect(Math.max(...shares) - Math.min(...shares)).toBeLessThan(0.03);
    });

    it('a higher tier never gets a smaller allowance than a lower one', () => {
        expect(totalCreditBudget('starter')).toBeGreaterThan(totalCreditBudget('free'));
        expect(totalCreditBudget('pro')).toBeGreaterThan(totalCreditBudget('starter'));
    });

    it('free funds at least one full redesign — the trial must be able to see the feature', () => {
        // Matches CREDITS_PER_REDESIGN in the backend's shared/aiCredits.ts. If that
        // estimate is recalibrated upward, free must rise with it or the trial silently
        // stops being able to run the thing that sells the product.
        const ESTIMATED_REDESIGN_CREDITS = 800_000;
        expect(creditBudget('free', 'design')).toBeGreaterThanOrEqual(ESTIMATED_REDESIGN_CREDITS);
    });

    it('every paid tier funds at least one full redesign after the option B price cut', () => {
        // The A$99 -> A$49 cut shrank starter design from 2.5M to 1.28M. It must not shrink
        // below one redesign, or a paying customer gets less than the free trial did.
        const ESTIMATED_REDESIGN_CREDITS = 800_000;
        for (const tier of ['starter', 'pro']) {
            expect(creditBudget(tier, 'design')).toBeGreaterThanOrEqual(ESTIMATED_REDESIGN_CREDITS);
        }
    });

    it('worst case stays within 15% of the option B prices in cents', () => {
        // Pinned in cents, independent of MONTHLY_AUD above, so a later edit to that
        // table cannot re-derive the guard against a price nobody publishes.
        expect(worstCaseAudCents('starter')).toBeLessThanOrEqual(Math.floor(4900 * 0.15));
        expect(worstCaseAudCents('pro')).toBeLessThanOrEqual(Math.floor(22000 * 0.15));
    });

    it('worstCaseAudCents tracks the rate assumption', () => {
        expect(worstCaseAudCents('pro'))
            .toBe(Math.round((totalCreditBudget('pro') / 1_000_000) * AUD_CENTS_PER_MILLION_CREDITS));
    });

    it('unlimited (-1) classes are excluded from the total rather than subtracted', () => {
        expect(totalCreditBudget('pro')).toBeGreaterThan(0);
        for (const tier of ['free', 'starter', 'pro']) expect(totalCreditBudget(tier)).toBeGreaterThan(0);
    });
});
