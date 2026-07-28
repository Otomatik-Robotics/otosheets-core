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
    it('returns the table value for every known (tier, class)', () => {
        expect(creditBudget('free', 'assistant')).toBe(300_000);
        expect(creditBudget('free', 'design')).toBe(60_000);
        expect(creditBudget('free', 'bulk')).toBe(200_000);
        expect(creditBudget('starter', 'assistant')).toBe(3_000_000);
        expect(creditBudget('starter', 'design')).toBe(900_000);
        expect(creditBudget('starter', 'bulk')).toBe(2_000_000);
        expect(creditBudget('pro', 'assistant')).toBe(15_000_000);
        expect(creditBudget('pro', 'design')).toBe(6_000_000);
        expect(creditBudget('pro', 'bulk')).toBe(10_000_000);
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
