/**
 * AI credit metering — the single source of truth for what an AI turn *costs*
 * the platform and how much of that each tier gets per month.
 *
 * Why credits and not raw tokens: `chatTokenBudget()` meters `inputTokens +
 * outputTokens` at 1:1, which does not track dollars. On Bedrock an output token
 * costs ~5x an input token, a cache *read* ~0.1x, and a cache *write* ~1.25x —
 * and cache reads are reported in their own field, so a cache-heavy turn is
 * billed by Bedrock but metered as ~nothing by the old counter. A credit is a
 * weighted cost unit (1 credit ≈ 1 input-token of spend), which makes the meter
 * move with the invoice instead of with the transcript length.
 *
 * This file is pure — no AWS, no I/O — so both the agent (pre-flight gate +
 * post-turn meter) and the backend (usage endpoints, upgrade prompts) import the
 * same numbers and can never drift.
 *
 * Back-compat: nothing here replaces `CHAT_TOKEN_BUDGET` / `chatTokenBudget()`.
 * The raw-token budget keeps working exactly as before; credits run alongside it.
 */
import type { SubscriptionTier } from './quotas';

/**
 * What an AI turn is *for*. The class drives both the output ceiling and the
 * meter it lands on, because the three have genuinely different shapes: an
 * assistant reply is short, a theme design patch rewrites whole files, a bulk
 * job is many medium turns.
 */
export type AiTaskClass = 'assistant' | 'design' | 'bulk';

export const AI_TASK_CLASSES: readonly AiTaskClass[] = ['assistant', 'design', 'bulk'] as const;

/**
 * Weighted cost units. 1 credit ~= 1 input-token of spend. Output is ~5x input,
 * a cache read ~0.1x, a cache write ~1.25x. These ratios are what make the meter
 * track dollars instead of raw tokens.
 */
export const CREDIT_WEIGHTS: { input: 1; output: 5; cacheRead: 0.1; cacheWrite: 1.25 } = {
    input: 1,
    output: 5,
    cacheRead: 0.1,
    cacheWrite: 1.25,
};

/** Token counts as reported by Bedrock/Strands for a single turn. All optional. */
export interface RawTokenUsage {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheWriteInputTokens?: number;
}

export interface AiModelSpec {
    /** Bedrock model id. */
    id: string;
    /** Per-turn output ceiling for this class. THIS IS THE OUTAGE FIX. */
    maxOutputTokens: number;
    /** Cost multiplier vs the baseline model (haiku = 1). Makes model switching reprice the quota. */
    multiplier: number;
    label: string;
}

/**
 * The only Bedrock model id verified to work in this account. Every slot points
 * at it today — the slots exist so that swapping one to a stronger model is a
 * one-line change here that reprices the quota (via `multiplier`) and re-caps
 * the turn (via `maxOutputTokens`).
 *
 * That repricing only reaches the meter for callers that price through the
 * spec — i.e. `creditsForSpec(usage, spec)` (or `creditsFor(usage,
 * spec.multiplier)`). A caller that hard-codes a multiplier keeps metering at
 * the old rate, silently, which is why `creditsFor` has no default multiplier:
 * the price must be stated at every call site.
 */
const HAIKU_4_5 = 'au.anthropic.claude-haiku-4-5-20251001-v1:0';

/**
 * Model slots, keyed by slot name. `maxOutputTokens` is the critical field: an
 * effective 2048-token ceiling platform-wide was truncating long generations
 * mid-stream, which is what took design runs down. Haiku 4.5 tops out at 64k
 * output, so 32k for a design patch is well inside the model's envelope.
 */
export const AI_MODELS: Record<string, AiModelSpec> = {
    assistant: {
        id: HAIKU_4_5,
        maxOutputTokens: 4096,
        multiplier: 1,
        label: 'Claude Haiku 4.5 — assistant',
    },
    design: {
        // A theme patch rewrites whole Liquid/CSS files in one turn, so this slot
        // needs headroom. A stronger model id goes here once it is enabled in the
        // account — do NOT put an unverified model id here before then.
        id: HAIKU_4_5,
        maxOutputTokens: 32000,
        multiplier: 1,
        label: 'Claude Haiku 4.5 — design',
    },
    bulk: {
        // A stronger/cheaper batch model id goes here once enabled in the account.
        id: HAIKU_4_5,
        maxOutputTokens: 8192,
        multiplier: 1,
        label: 'Claude Haiku 4.5 — bulk',
    },
};

/**
 * (tier, class) -> model slot. Currently every entry resolves to the class's own
 * slot regardless of tier; the table exists so that "pro gets the stronger design
 * model" is a data edit, not a refactor of every call site.
 */
const MODEL_ROUTE: Record<SubscriptionTier, Record<AiTaskClass, string>> = {
    free: { assistant: 'assistant', design: 'design', bulk: 'bulk' },
    starter: { assistant: 'assistant', design: 'design', bulk: 'bulk' },
    pro: { assistant: 'assistant', design: 'design', bulk: 'bulk' },
};

/**
 * Roughly what one credit costs us, in AUD cents per million credits.
 *
 * A credit is one input-token-equivalent (see CREDIT_WEIGHTS), so this is the
 * blended input rate of the baseline model. Haiku 4.5 is about USD $1 per
 * million input tokens; at ~0.65 USD/AUD that is ~A$1.55, rounded up to A$1.60
 * for headroom.
 *
 * ASSUMPTION, NOT A MEASUREMENT. We are on Bedrock, which is priced separately
 * from Anthropic's first-party rates. Confirm against the Bedrock pricing page
 * and correct this one number — every budget below is derived from it, so the
 * whole table re-derives when it changes.
 */
export const AUD_CENTS_PER_MILLION_CREDITS = 160;

/**
 * Share of subscription revenue we are willing to spend on AI at FULL
 * utilisation. This is the margin guard: it is what makes the worst case
 * knowable before anyone signs up, and it stays knowable when the model
 * changes because AiModelSpec.multiplier reprices credits automatically.
 *
 * 15% is deliberately generous — almost nobody will reach their ceiling — while
 * still leaving room for hosting, Stripe fees and support underneath it.
 */
export const AI_REVENUE_SHARE = 0.15;

/**
 * Monthly credit allowance per (tier, class). -1 = unlimited.
 *
 * DERIVED, not picked. Tier prices are the published AUD monthly rates:
 * Solo (starter) A$49, Crew (pro) A$99 (Option B pricing — was A$99 / A$149).
 *
 *   budget ≈ price × AI_REVENUE_SHARE ÷ (AUD_CENTS_PER_MILLION_CREDITS / 100)
 *
 *   starter  $49 × 15% = A$7.35  → ~4.59M → 4.59M  (14.98% of revenue)
 *   pro      $99 × 15% = A$14.85 → ~9.28M → 9.27M  (14.98% of revenue)
 *
 * Each tier's total is split across the three classes in the same proportions
 * the previous table used (starter 5.0/2.5/1.5 of 9.0; pro 8.0/4.0/1.9 of
 * 13.9), then rounded to 10k so the totals sit just UNDER the guard rather
 * than exactly on it — a total that lands on 15.00% passes only by
 * floating-point luck, and the guard test is meant to bite, not to be
 * gamed. Starter design stays above 1.0M so one full redesign
 * (~800k credits, see CREDITS_PER_REDESIGN in the backend) fits inside it.
 *
 * The table before that was not derived and was inconsistent across tiers:
 * starter capped AI at ~9.5% of revenue while pro capped at ~33%, so the two
 * tiers carried very different margin exposure for no stated reason.
 *
 * FREE IS NOT REVENUE-FUNDED — it is a trial, so its allowance is acquisition
 * cost, not a margin calculation. It is sized to fund exactly ONE full-quality
 * redesign (estimated ~800k credits) plus enough chat to evaluate the product:
 * ~1.8M credits, about A$2.88 per trial. The prior 60k funded ZERO redesigns,
 * which meant a trial user could never see the feature that sells the product.
 * One good redesign converts; five degraded ones do not.
 *
 * **This object is the single place to change any of it** — budgets, gating,
 * upgrade prompts and the usage UI all read through `creditBudget()`.
 */
export const CREDIT_BUDGET: Record<SubscriptionTier, Record<AiTaskClass, number>> = {
    free: { assistant: 500_000, design: 1_000_000, bulk: 300_000 },
    // 4.59M total; the derived ceiling is 4.594M (A$7.35 ÷ A$1.60).
    starter: { assistant: 2_550_000, design: 1_280_000, bulk: 760_000 },
    // 9.27M total; the derived ceiling is 9.281M (A$14.85 ÷ A$1.60). 9.28M would
    // round to exactly 15.00% of A$99, so bulk gives up 10k to stay clear of it.
    pro: { assistant: 5_340_000, design: 2_670_000, bulk: 1_260_000 },
};

/** Total monthly credit allowance for a tier across every class. */
export function totalCreditBudget(tier?: string | null): number {
    const row = CREDIT_BUDGET[asTier(tier)];
    return AI_TASK_CLASSES.reduce((sum, c) => (row[c] === -1 ? sum : sum + row[c]), 0);
}

/** Worst-case monthly AI cost for a tier, in AUD cents, at full utilisation. */
export function worstCaseAudCents(tier?: string | null): number {
    return Math.round((totalCreditBudget(tier) / 1_000_000) * AUD_CENTS_PER_MILLION_CREDITS);
}

/**
 * Normalise an arbitrary tier string. Mirrors the private `asTier` in
 * `quotas.ts` (kept local so this module stays additive and cannot regress the
 * existing quota helpers). Unknown / missing → the free tier.
 */
const asTier = (tier?: string | null): SubscriptionTier =>
    tier === 'starter' || tier === 'pro' ? tier : 'free';

/** Normalise an arbitrary task class. Unknown / missing → 'assistant'. */
const asTaskClass = (taskClass?: string | null): AiTaskClass =>
    taskClass === 'design' || taskClass === 'bulk' ? taskClass : 'assistant';

/** Coerce a reported token count to a usable non-negative finite number. */
const tokens = (n: unknown): number => {
    const v = Number(n);
    return Number.isFinite(v) && v > 0 ? v : 0;
};

/** (tier, class) -> model spec. Defaults to free tier + the assistant class. */
export function resolveModelSpec(tier?: string | null, taskClass?: AiTaskClass): AiModelSpec {
    const cls = asTaskClass(taskClass);
    const slot = MODEL_ROUTE[asTier(tier)][cls];
    return AI_MODELS[slot] ?? AI_MODELS[cls] ?? AI_MODELS.assistant;
}

/**
 * Weighted credit cost of one turn, rounded to a whole integer credit.
 *
 * `multiplier` is REQUIRED and deliberately has no default. It exists so that
 * repricing a model slot reprices the quota — a default of 1 would let every
 * call site keep metering at the baseline rate after `AI_MODELS.design
 * .multiplier` moved to 4, under-reporting the most expensive task class by 4x
 * with no compile error. Prefer `creditsForSpec(usage, spec)`, which takes the
 * multiplier straight off the resolved model and cannot drift.
 *
 * Robust by construction: missing, NaN, Infinite and negative counts all
 * contribute zero rather than poisoning the total, so a malformed usage report
 * can never write NaN or a negative into the DynamoDB counter. Any turn that
 * consumed at least one billable token costs at least 1 credit — otherwise a
 * long tail of tiny cache-read turns would each round to zero and go unmetered,
 * which is the very failure mode this function exists to fix.
 *
 * A non-finite or non-positive `multiplier` falls back to the baseline 1: the
 * meter fails closed (we still charge) rather than open (free usage).
 */
export function creditsFor(usage: RawTokenUsage, multiplier: number): number {
    const u = usage ?? {};
    const m = Number(multiplier);
    const factor = Number.isFinite(m) && m > 0 ? m : 1;

    const weighted =
        tokens(u.inputTokens) * CREDIT_WEIGHTS.input +
        tokens(u.outputTokens) * CREDIT_WEIGHTS.output +
        tokens(u.cacheReadInputTokens) * CREDIT_WEIGHTS.cacheRead +
        tokens(u.cacheWriteInputTokens) * CREDIT_WEIGHTS.cacheWrite;

    const total = weighted * factor;
    if (!Number.isFinite(total) || total <= 0) return 0;
    return Math.max(1, Math.round(total));
}

/**
 * Weighted credit cost of one turn priced against a specific model slot.
 *
 * This is the entry point every metering call site should use: the multiplier
 * comes off the spec that actually served the turn, so the day a slot is
 * repointed at a costlier model the quota reprices itself. `creditsFor` with a
 * hand-written multiplier is the escape hatch, not the norm.
 */
export function creditsForSpec(usage: RawTokenUsage, spec?: AiModelSpec | null): number {
    return creditsFor(usage, spec?.multiplier ?? 1);
}

/**
 * Price a turn for a (tier, class) without the caller having to resolve the
 * model first — `resolveModelSpec` and `creditsForSpec` in one step, so the
 * multiplier can never be forgotten.
 */
export function creditsForTurn(
    usage: RawTokenUsage,
    tier?: string | null,
    taskClass?: AiTaskClass,
): number {
    return creditsForSpec(usage, resolveModelSpec(tier, taskClass));
}

/** Monthly credit allowance. -1 = unlimited. Defaults to free tier + assistant class. */
export function creditBudget(tier?: string | null, taskClass?: AiTaskClass): number {
    return CREDIT_BUDGET[asTier(tier)][asTaskClass(taskClass)];
}

/**
 * DynamoDB usage metric name for a class, e.g. 'credits:design'.
 * These strings are the wire contract — they must stay identical to
 * `USAGE_METRIC.CREDITS_*` in `src/usage/schema.ts`.
 */
export function creditMetric(taskClass: AiTaskClass): string {
    return `credits:${asTaskClass(taskClass)}`;
}
