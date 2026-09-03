import { z } from 'zod';

/**
 * Monthly usage meter, one record per (org, metric, month).
 *
 * Two families of meter live in this table:
 *
 * - **`chatTokens`** — the original raw-token meter, counted against
 *   `chatTokenBudget(tier)`. Unchanged.
 * - **`credits:{assistant|design|bulk}`** — the weighted AI credit meters,
 *   counted against `creditBudget(tier, class)`. A credit is a cost-weighted
 *   token (output is worth ~5x an input token, a cache read ~0.1x), so the
 *   meter tracks spend rather than raw volume. See `../limits/aiCredits`.
 *
 * Keyed PK `orgId`, SK `USAGE#{metric}#{YYYY-MM}`. Old buckets expire via the
 * `ttl` attribute so the table stays small. Every counter is written with an
 * atomic DynamoDB `ADD`, never read-modify-write.
 */
export const UsageRecordSchema = z.object({
    orgId: z.string(),
    sk: z.string(),
    metric: z.string(),       // e.g. 'chatTokens', 'credits:design'
    month: z.string(),        // 'YYYY-MM'
    inputTokens: z.number().default(0),
    outputTokens: z.number().default(0),
    /** Prompt-cache hits (billed ~0.1x an input token). Credit meters only. */
    cacheReadTokens: z.number().default(0),
    /** Prompt-cache writes (billed ~1.25x an input token). Credit meters only. */
    cacheWriteTokens: z.number().default(0),
    /** Raw tokens metered on this row: input + output + cache read + cache write. */
    totalTokens: z.number().default(0),
    /** Weighted cost units — always a whole integer (see `creditsFor`). */
    credits: z.number().default(0),
    createdAt: z.string(),
    updatedAt: z.string(),
    ttl: z.number().nullish(),
});
export type UsageRecord = z.infer<typeof UsageRecordSchema>;

/**
 * Known usage metric names.
 *
 * The `CREDITS_*` values must stay byte-identical to `creditMetric(taskClass)`
 * in `../limits/aiCredits` — that function is the canonical builder and this
 * object is the lookup table. `repo.test.ts` asserts the two agree.
 */
export const USAGE_METRIC = {
    CHAT_TOKENS: 'chatTokens',
    CREDITS_ASSISTANT: 'credits:assistant',
    CREDITS_DESIGN: 'credits:design',
    CREDITS_BULK: 'credits:bulk',
} as const;

/** Returns the current usage month bucket in `YYYY-MM` (UTC). */
export function currentUsageMonth(date: Date = new Date()): string {
    return date.toISOString().slice(0, 7);
}
