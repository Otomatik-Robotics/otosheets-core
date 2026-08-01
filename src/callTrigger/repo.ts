import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { CallTrigger } from './schema';

/**
 * Call triggers share the call-records table (PK orgId) under their own sk
 * prefix — TRIGGER#{triggerId} never collides with AGENT#{agentId} or
 * CALL#{leadId}#{callId}. Same pattern as VoiceAgentRepo, so no new table and
 * no CDK resources (see CDK_RESOURCE_BUDGET.md).
 *
 * DynamoDB, permanently: this is keyed configuration read on the hot path of an
 * event fan-out, never joined or reported on — the dividing rule in CLAUDE.md
 * §"Source of Truth" puts it here rather than Postgres.
 */
const skOf = (triggerId: string) => `TRIGGER#${triggerId}`;
const SK_PREFIX = 'TRIGGER#';

export class CallTriggerRepo {
    constructor(private ddb: IDdb) {}

    async get(orgId: string, triggerId: string): Promise<CallTrigger | null> {
        const { Item } = await this.ddb.getItem(Tables.CALL_RECORDS, { orgId, sk: skOf(triggerId) });
        return (Item as CallTrigger) ?? null;
    }

    async put(orgId: string, triggerId: string, data: Partial<CallTrigger>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.CALL_RECORDS, {
            orgId,
            sk: skOf(triggerId),
            triggerId,
            ...data,
            createdAt: data.createdAt ?? now,
            updatedAt: now,
        });
    }

    /**
     * Create only if absent. Seeding the default win-back trigger runs on every
     * org that enables voice, and may run again on redeploy — this makes that
     * safe to repeat and, critically, means a re-seed never resurrects a trigger
     * the owner deliberately disabled or edited.
     */
    async createIfAbsent(orgId: string, triggerId: string, data: Partial<CallTrigger>): Promise<boolean> {
        const now = new Date().toISOString();
        // `put` on the port takes no options, so the guarded write goes through
        // transactWrite — the one path that carries a ConditionExpression.
        try {
            await this.ddb.transactWrite([{
                Put: {
                    TableName: Tables.CALL_RECORDS,
                    Item: { orgId, sk: skOf(triggerId), triggerId, ...data, createdAt: now, updatedAt: now },
                    ConditionExpression: 'attribute_not_exists(orgId) AND attribute_not_exists(sk)',
                },
            }]);
            return true;
        } catch (err: any) {
            const cancelled = err?.name === 'TransactionCanceledException'
                && (err.CancellationReasons ?? []).some((r: any) => r?.Code === 'ConditionalCheckFailed');
            if (cancelled || err?.name === 'ConditionalCheckFailedException') return false;
            throw err;
        }
    }

    async update(orgId: string, triggerId: string, fields: Partial<CallTrigger>): Promise<void> {
        const entries = Object.entries(fields).filter(
            ([k, v]) => v !== undefined && !['orgId', 'sk', 'triggerId', 'createdAt'].includes(k),
        );
        if (entries.length === 0) return;
        const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
        const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };
        const sets = ['#updatedAt = :updatedAt'];
        for (const [k, v] of entries) {
            names[`#${k}`] = k;
            values[`:${k}`] = v;
            sets.push(`#${k} = :${k}`);
        }
        await this.ddb.update(Tables.CALL_RECORDS, { orgId, sk: skOf(triggerId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }

    async list(orgId: string, limit = 50): Promise<CallTrigger[]> {
        const result = await this.ddb.query({
            TableName: Tables.CALL_RECORDS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': SK_PREFIX },
            Limit: limit,
        });
        return (result.Items as CallTrigger[]) ?? [];
    }

    /**
     * The triggers that should fire for an event — enabled, matching type.
     * Filtered in memory over the org's own small config set (a handful of rows
     * fetched by key), not over a data table.
     */
    async listForEvent(orgId: string, eventType: string): Promise<CallTrigger[]> {
        const all = await this.list(orgId);
        return all.filter(t => t.enabled && t.eventType === eventType);
    }

    async delete(orgId: string, triggerId: string): Promise<void> {
        await this.ddb.delete(Tables.CALL_RECORDS, { orgId, sk: skOf(triggerId) });
    }
}
