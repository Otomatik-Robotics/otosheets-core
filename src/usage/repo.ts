import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { usageSk, usageTurnSk } from '../keys';
import {
    AI_TASK_CLASSES,
    AiTaskClass,
    RawTokenUsage,
    creditMetric,
    creditsForSpec,
    resolveModelSpec,
} from '../limits/aiCredits';
import { UsageRecord, UsageRecordSchema, USAGE_METRIC, currentUsageMonth } from './schema';

// Monthly buckets are retained ~13 months then expire via TTL.
const USAGE_TTL_SECONDS = 400 * 24 * 60 * 60;
// Turn dedupe markers only need to outlive the retry window of any at-least-once
// trigger (SDK retry, Lambda async retry, SSE reconnect replay). 7 days is ample.
const TURN_MARKER_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Hard ceiling for a single counter delta. `marshall` throws outright above
 * `Number.MAX_SAFE_INTEGER`, and below it a mis-mapped field (a millisecond
 * timestamp landing in a token count) would permanently add ~1.7e12 to the
 * month and lock the org out of AI with no way back — the counters are
 * monotonic by design, so there is no compensating write. 1e12 is ~66,000x a
 * pro org's entire monthly budget: it can only ever truncate garbage.
 */
const MAX_COUNTER = 1e12;

/**
 * Coerce a counter delta to a whole, non-negative, finite, in-range number.
 *
 * These values go straight into a DynamoDB `ADD`, which throws on NaN/Infinity
 * and on anything above `Number.MAX_SAFE_INTEGER`, and would permanently
 * corrupt a meter if handed a negative. `creditsFor()` already guarantees a
 * clean integer, but `CreditDelta` is a plain interface that any caller can
 * hand-build from a raw provider usage report — this is the last line of
 * defence, and a malformed report must cost the meter nothing rather than take
 * the whole write (or the whole month's total) down with it.
 *
 * A positive value below 1 rounds UP, never down to zero — the same policy as
 * `creditsFor()`, which floors a billable turn at 1 credit precisely so a long
 * tail of tiny cached turns cannot each meter as free.
 */
const counter = (n: unknown): number => {
    const raw = Number(n);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return Math.min(Math.max(1, Math.round(raw)), MAX_COUNTER);
};

/** Read-side coercion: a stored counter that is missing or junk reads as 0. */
const readCounter = (n: unknown): number => {
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
};

/**
 * True when a failed transactWrite was cancelled because a ConditionExpression
 * failed — i.e. the turn marker already existed, so this meter write is a
 * replay we can safely treat as a no-op. Mirrors `isDuplicateLedgerWrite` in
 * `../voiceCredit/repo.ts`, the platform's reference idempotent-ledger write.
 */
function isDuplicateTurnWrite(err: any): boolean {
    if (err?.name !== 'TransactionCanceledException') return false;
    const reasons: any[] = err?.CancellationReasons ?? [];
    return reasons.some((r) => r?.Code === 'ConditionalCheckFailed');
}

/**
 * A single metered AI call, already weighted into credits by `creditsFor()`.
 * The raw token counts are carried alongside for attribution/debugging.
 *
 * `credits` is the number the budget is enforced on, so it is never trusted
 * blindly: if it is absent/zero while the raw breakdown shows billable tokens,
 * `incrementCredits` re-derives it from the breakdown rather than recording a
 * free turn (the cache-heavy-turn failure mode `creditsFor` exists to fix).
 * Prefer `meterAiTurn()`, which derives all five numbers from one usage report.
 */
export interface CreditDelta {
    /** Weighted cost units. Must be a whole integer (`creditsFor()` rounds). */
    credits: number;
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    /**
     * Idempotency key for this turn. When supplied, the counter `ADD` is wrapped
     * in a transaction alongside a conditional marker, so replaying the same
     * turn (SDK retry after a lost response, Lambda async retry, SSE reconnect)
     * is a no-op instead of a double charge. Strongly recommended: without it
     * the write is concurrency-safe but NOT replay-safe, and an over-count
     * cannot be undone.
     */
    turnId?: string;
}

/** Recognised `CreditDelta` fields — used to reject a mis-mapped delta shape. */
const CREDIT_DELTA_FIELDS = ['credits', 'input', 'output', 'cacheRead', 'cacheWrite', 'turnId'];

/** Post-write meter totals, read straight off the atomic update. */
export interface CreditTotals {
    credits: number;
    totalTokens: number;
}

/** Read options for meter lookups. */
export interface UsageReadOptions {
    /**
     * Force a strongly consistent read. Use for a pre-flight budget gate: an
     * eventually consistent read can miss the org's own just-written turns, so
     * a parallel fan-out all sees itself under budget and the gate never fires.
     */
    consistent?: boolean;
}

export class UsageRepo {
    constructor(private ddb: IDdb) {}

    /** Read a single (org, metric, month) meter. Returns null if untouched. */
    async getMonth(
        orgId: string,
        metric: string,
        month: string,
        options: UsageReadOptions = {},
    ): Promise<UsageRecord | null> {
        const { Item } = await this.ddb.getItem(
            Tables.USAGE,
            { orgId, sk: usageSk(metric, month) },
            options.consistent ? { ConsistentRead: true } : undefined,
        );
        if (!Item) return null;
        // Parse, never cast: `UsageRecord` declares credits/cacheReadTokens/
        // cacheWriteTokens as required numbers, but rows written by the legacy
        // `increment()` path carry none of them. A cast hands back `undefined`
        // behind a type that says `number`, and a gate written as
        // `row.credits >= budget` then evaluates `undefined >= n` → false and
        // silently fails open. The schema's `.default(0)` normalises them here.
        const parsed = UsageRecordSchema.safeParse(Item);
        if (parsed.success) return parsed.data;
        // A row too malformed to parse (hand-written, or predating a required
        // field) must still read as a meter rather than throw on the hot path —
        // but its counters are still guaranteed numeric.
        const raw = Item as Record<string, any>;
        return {
            ...raw,
            inputTokens: readCounter(raw.inputTokens),
            outputTokens: readCounter(raw.outputTokens),
            cacheReadTokens: readCounter(raw.cacheReadTokens),
            cacheWriteTokens: readCounter(raw.cacheWriteTokens),
            totalTokens: readCounter(raw.totalTokens),
            credits: readCounter(raw.credits),
        } as UsageRecord;
    }

    /** Convenience: chat-token meter for the given (or current) month. */
    async getChatTokens(
        orgId: string,
        month: string = currentUsageMonth(),
        options: UsageReadOptions = {},
    ): Promise<UsageRecord | null> {
        return this.getMonth(orgId, USAGE_METRIC.CHAT_TOKENS, month, options);
    }

    /**
     * Atomically add token counts to a monthly meter (no read-modify-write).
     * Creates the record on first write (`createdAt`/`ttl` set once).
     *
     * Counts are coerced through `counter()` for the same reason the credit
     * meter's are: this is fed from an untrusted provider usage report, and a
     * NaN would throw the whole write away (metering the turn as nothing) while
     * a negative would permanently claw back the month's total.
     */
    async increment(
        orgId: string,
        metric: string,
        month: string,
        tokens: { input?: number; output?: number },
    ): Promise<void> {
        // This method cannot write the `credits` counter, so pointing it at a
        // credit meter would bump that row's raw tokens while leaving `credits`
        // absent — the meter would read 0 forever and the class would be free.
        if (metric.startsWith('credits:')) {
            throw new Error(
                `UsageRepo.increment cannot write the credit meter '${metric}' — use incrementCredits()/meterAiTurn()`,
            );
        }
        const input = counter(tokens?.input);
        const output = counter(tokens?.output);
        const total = input + output;
        const now = new Date().toISOString();
        const ttl = Math.floor(Date.now() / 1000) + USAGE_TTL_SECONDS;

        await this.ddb.update(Tables.USAGE, { orgId, sk: usageSk(metric, month) }, {
            UpdateExpression:
                'ADD inputTokens :i, outputTokens :o, totalTokens :t ' +
                'SET #metric = :metric, #month = :month, updatedAt = :now, ' +
                'createdAt = if_not_exists(createdAt, :now), #ttl = if_not_exists(#ttl, :ttl)',
            ExpressionAttributeNames: {
                '#metric': 'metric',
                '#month': 'month',
                '#ttl': 'ttl',
            },
            ExpressionAttributeValues: {
                ':i': input,
                ':o': output,
                ':t': total,
                ':metric': metric,
                ':month': month,
                ':now': now,
                ':ttl': ttl,
            },
        });
    }

    /** Convenience: add chat tokens to the current (or given) month. */
    async incrementChatTokens(
        orgId: string,
        tokens: { input?: number; output?: number },
        month: string = currentUsageMonth(),
    ): Promise<void> {
        return this.increment(orgId, USAGE_METRIC.CHAT_TOKENS, month, tokens);
    }

    /**
     * Meter one AI turn from its raw provider usage report — the correct-by-
     * construction path, and the one callers should reach for.
     *
     * All five numbers (credits + the four token counts) are derived here from
     * a single input, priced through the model spec that actually served the
     * turn, so the credit figure can never disagree with the breakdown beside
     * it and repricing a model slot reprices the meter.
     *
     * `turnId` makes the write replay-safe — pass the agent run/turn id.
     */
    async meterAiTurn(
        orgId: string,
        taskClass: AiTaskClass,
        usage: RawTokenUsage,
        opts: { tier?: string | null; turnId?: string; month?: string } = {},
    ): Promise<CreditTotals> {
        const month = opts.month ?? currentUsageMonth();
        const u = usage ?? {};
        const credits = creditsForSpec(u, resolveModelSpec(opts.tier, taskClass));
        if (credits <= 0) {
            // Nothing billable was reported — don't create a meter row for it.
            const row = await this.getCredits(orgId, taskClass, month);
            return { credits: row?.credits ?? 0, totalTokens: row?.totalTokens ?? 0 };
        }
        return this.incrementCredits(
            orgId,
            taskClass,
            {
                credits,
                input: u.inputTokens,
                output: u.outputTokens,
                cacheRead: u.cacheReadInputTokens,
                cacheWrite: u.cacheWriteInputTokens,
                turnId: opts.turnId,
            },
            month,
        );
    }

    /**
     * Atomically add weighted credits (plus the raw token breakdown that
     * produced them) to the `credits:{class}` meter for the month, and return
     * the resulting totals.
     *
     * One `ADD`, no read first — concurrency-safe (no lost updates) under any
     * amount of parallelism. It is **replay-safe only when `delta.turnId` is
     * supplied**: with it, the counter update rides in a transaction next to a
     * conditional marker and a duplicate is a no-op; without it, an at-least-
     * once retry double-charges and — because the counters reject negatives —
     * the over-count cannot be corrected through this API.
     *
     * `delta.credits` must already be an integer (`creditsFor()` rounds), and
     * is re-derived from the raw breakdown if it is missing while real tokens
     * are present, so a turn can never be recorded as free by accident.
     */
    async incrementCredits(
        orgId: string,
        taskClass: AiTaskClass,
        delta: CreditDelta,
        month: string = currentUsageMonth(),
    ): Promise<CreditTotals> {
        const metric = creditMetric(taskClass);
        const keys = Object.keys(delta ?? {});
        // A delta carrying only unrecognised keys is a mis-mapped call — most
        // likely a `RawTokenUsage` (inputTokens/outputTokens/…) passed straight
        // in, which shares no field name with this shape and would coerce to an
        // all-zero write. The meter fails closed: throw rather than silently
        // record a free turn.
        if (keys.length > 0 && !keys.some((k) => CREDIT_DELTA_FIELDS.includes(k))) {
            throw new Error(
                `UsageRepo.incrementCredits got an unrecognised delta shape (${keys.join(', ')}) — ` +
                    'expected CreditDelta; use meterAiTurn() for a RawTokenUsage',
            );
        }

        const input = counter(delta?.input);
        const output = counter(delta?.output);
        const cacheRead = counter(delta?.cacheRead);
        const cacheWrite = counter(delta?.cacheWrite);
        const total = input + output + cacheRead + cacheWrite;
        // Never let a caller-supplied 0 book a turn that consumed real tokens as
        // free: re-price the breakdown at the baseline rate instead.
        const credits =
            counter(delta?.credits) ||
            creditsForSpec(
                {
                    inputTokens: input,
                    outputTokens: output,
                    cacheReadInputTokens: cacheRead,
                    cacheWriteInputTokens: cacheWrite,
                },
                resolveModelSpec(null, taskClass),
            );

        const now = new Date().toISOString();
        const nowSeconds = Math.floor(Date.now() / 1000);
        const ttl = nowSeconds + USAGE_TTL_SECONDS;
        const key = { orgId, sk: usageSk(metric, month) };
        const update = {
            UpdateExpression:
                'ADD credits :c, inputTokens :i, outputTokens :o, ' +
                'cacheReadTokens :cr, cacheWriteTokens :cw, totalTokens :t ' +
                'SET #metric = :metric, #month = :month, updatedAt = :now, ' +
                'createdAt = if_not_exists(createdAt, :now), #ttl = if_not_exists(#ttl, :ttl)',
            ExpressionAttributeNames: {
                '#metric': 'metric',
                '#month': 'month',
                '#ttl': 'ttl',
            },
            ExpressionAttributeValues: {
                ':c': credits,
                ':i': input,
                ':o': output,
                ':cr': cacheRead,
                ':cw': cacheWrite,
                ':t': total,
                ':metric': metric,
                ':month': month,
                ':now': now,
                ':ttl': ttl,
            },
        };

        if (delta?.turnId) {
            try {
                await this.ddb.transactWrite([
                    {
                        Put: {
                            TableName: Tables.USAGE,
                            Item: {
                                orgId,
                                sk: usageTurnSk(metric, delta.turnId),
                                metric,
                                month,
                                credits,
                                turnId: delta.turnId,
                                createdAt: now,
                                ttl: nowSeconds + TURN_MARKER_TTL_SECONDS,
                            },
                            ConditionExpression: 'attribute_not_exists(sk)',
                        },
                    },
                    { Update: { TableName: Tables.USAGE, Key: key, ...update } },
                ]);
            } catch (err) {
                // Already metered — a replay, not a second turn.
                if (!isDuplicateTurnWrite(err)) throw err;
            }
            // transactWrite returns no attributes; read the meter back
            // consistently so the caller still gets an exact post-write total.
            const row = await this.getCredits(orgId, taskClass, month, { consistent: true });
            return { credits: row?.credits ?? 0, totalTokens: row?.totalTokens ?? 0 };
        }

        // `UPDATED_NEW` hands back the authoritative post-`ADD` totals for free,
        // so the caller's budget check needs no second (eventually consistent)
        // read.
        const res = await this.ddb.update(Tables.USAGE, key, { ...update, ReturnValues: 'UPDATED_NEW' });
        const attrs = (res?.Attributes ?? {}) as Record<string, any>;
        return {
            credits: readCounter(attrs.credits),
            totalTokens: readCounter(attrs.totalTokens),
        };
    }

    /** Read the credit meter for one task class. Returns null if untouched. */
    async getCredits(
        orgId: string,
        taskClass: AiTaskClass,
        month: string = currentUsageMonth(),
        options: UsageReadOptions = {},
    ): Promise<UsageRecord | null> {
        return this.getMonth(orgId, creditMetric(taskClass), month, options);
    }

    /**
     * Credit totals for every task class in one shot — one meter read per
     * class, in parallel. Classes with no meter yet report 0, never undefined,
     * so callers can subtract from a budget without null-guarding.
     *
     * Pass `{ consistent: true }` when the result gates spend.
     */
    async getAllCredits(
        orgId: string,
        month: string = currentUsageMonth(),
        options: UsageReadOptions = {},
    ): Promise<Record<AiTaskClass, number>> {
        const rows = await Promise.all(
            AI_TASK_CLASSES.map((taskClass) => this.getCredits(orgId, taskClass, month, options)),
        );
        const totals = {} as Record<AiTaskClass, number>;
        AI_TASK_CLASSES.forEach((taskClass, i) => {
            totals[taskClass] = rows[i]?.credits ?? 0;
        });
        return totals;
    }
}
