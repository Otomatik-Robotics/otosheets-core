import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { usageSk } from '../keys';
import { UsageRecord, USAGE_METRIC, currentUsageMonth } from './schema';

// Monthly buckets are retained ~13 months then expire via TTL.
const USAGE_TTL_SECONDS = 400 * 24 * 60 * 60;

export class UsageRepo {
    constructor(private ddb: IDdb) {}

    /** Read a single (org, metric, month) meter. Returns null if untouched. */
    async getMonth(orgId: string, metric: string, month: string): Promise<UsageRecord | null> {
        const { Item } = await this.ddb.getItem(Tables.USAGE, {
            orgId,
            sk: usageSk(metric, month),
        });
        return (Item as UsageRecord) ?? null;
    }

    /** Convenience: chat-token meter for the given (or current) month. */
    async getChatTokens(orgId: string, month: string = currentUsageMonth()): Promise<UsageRecord | null> {
        return this.getMonth(orgId, USAGE_METRIC.CHAT_TOKENS, month);
    }

    /**
     * Atomically add token counts to a monthly meter (no read-modify-write).
     * Creates the record on first write (`createdAt`/`ttl` set once).
     */
    async increment(
        orgId: string,
        metric: string,
        month: string,
        tokens: { input?: number; output?: number },
    ): Promise<void> {
        const input = tokens.input ?? 0;
        const output = tokens.output ?? 0;
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
}
