import type { IDdb } from '../ddbPort';
import { Tables } from '../tables';

export interface WorkflowPageOptions { nextToken?: string; limit?: number }
interface Filters { workflowId?: string; runId?: string; status?: string; isActive?: boolean; search?: string }

/** Pagination tokens belong to one tenant, record prefix and filter selection. */
export async function workflowPage<T>(db: IDdb, orgId: string, prefix: string, options: WorkflowPageOptions, filters: Filters = {}): Promise<{ items: T[]; nextToken?: string }> {
    if (!orgId || orgId.startsWith('__')) throw new Error('Invalid workflow organisation');
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Workflow page limit must be between 1 and 100');
    const values: Record<string, unknown> = { ':org': orgId, ':prefix': prefix };
    const names: Record<string, string> = {};
    const conditions: string[] = [];
    for (const field of ['workflowId', 'runId', 'status', 'isActive'] as const) {
        if (filters[field] === undefined) continue;
        names[`#${field}`] = field;
        values[`:${field}`] = filters[field];
        conditions.push(`#${field} = :${field}`);
    }
    if (filters.search) {
        names['#name'] = 'name'; names['#description'] = 'description';
        values[':search'] = filters.search;
        conditions.push('(contains(#name, :search) OR contains(#description, :search))');
    }
    const identity = JSON.stringify([orgId, prefix, values]);
    let exclusiveStartKey: { orgId: string; sk: string } | undefined;
    if (options.nextToken) {
        try {
            const token = JSON.parse(Buffer.from(options.nextToken, 'base64').toString('utf8'));
            if (token.identity !== identity || token.key?.orgId !== orgId || typeof token.key.sk !== 'string' || !token.key.sk.startsWith(prefix)) throw new Error();
            exclusiveStartKey = { orgId, sk: token.key.sk };
        } catch { throw new Error('Invalid workflow page token'); }
    }
    const result = await db.query({
        TableName: Tables.ONBOARDING,
        KeyConditionExpression: 'orgId = :org AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: values,
        ...(conditions.length ? { FilterExpression: conditions.join(' AND '), ExpressionAttributeNames: names } : {}),
        Limit: limit, ScanIndexForward: false,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    });
    return { items: (result.Items ?? []) as T[], ...(result.LastEvaluatedKey ? { nextToken: Buffer.from(JSON.stringify({ identity, key: result.LastEvaluatedKey })).toString('base64') } : {}) };
}
