import { z } from 'zod';

/**
 * Monthly usage meter, one record per (org, metric, month).
 *
 * Currently used for AI chat token metering against a per-tier monthly
 * budget. Keyed PK `orgId`, SK `USAGE#{metric}#{YYYY-MM}`. Old buckets
 * expire via the `ttl` attribute so the table stays small.
 */
export const UsageRecordSchema = z.object({
    orgId: z.string(),
    sk: z.string(),
    metric: z.string(),       // e.g. 'chatTokens'
    month: z.string(),        // 'YYYY-MM'
    inputTokens: z.number().default(0),
    outputTokens: z.number().default(0),
    totalTokens: z.number().default(0),
    createdAt: z.string(),
    updatedAt: z.string(),
    ttl: z.number().nullish(),
});
export type UsageRecord = z.infer<typeof UsageRecordSchema>;

/** Known usage metric names. */
export const USAGE_METRIC = {
    CHAT_TOKENS: 'chatTokens',
} as const;

/** Returns the current usage month bucket in `YYYY-MM` (UTC). */
export function currentUsageMonth(date: Date = new Date()): string {
    return date.toISOString().slice(0, 7);
}
