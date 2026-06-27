import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { Pipeline } from './schema';

export class PipelineRepo {
    constructor(private ddb: IDdb) {}

    async getPipeline(orgId: string, pipelineId: string): Promise<Pipeline | null> {
        const { Item } = await this.ddb.getItem(Tables.PIPELINES, { orgId, pipelineId });
        return (Item as Pipeline) ?? null;
    }

    async listPipelines(orgId: string): Promise<Pipeline[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.PIPELINES,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return (Items as Pipeline[]) ?? [];
    }

    /**
     * Full-table scan of every pipeline across all orgs. Background-cron use only
     * (e.g. the 12-hour insights precompute) — never call from a request handler.
     */
    async scanAllPipelines(): Promise<Pipeline[]> {
        const all: Pipeline[] = [];
        let exclusiveStartKey: Record<string, any> | undefined;
        do {
            const res = await this.ddb.scan({
                TableName: Tables.PIPELINES,
                ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
            });
            all.push(...((res.Items as Pipeline[]) ?? []));
            exclusiveStartKey = res.LastEvaluatedKey;
        } while (exclusiveStartKey);
        return all;
    }

    async getDefaultPipeline(orgId: string): Promise<Pipeline | null> {
        const { Items } = await this.ddb.query({
            TableName: Tables.PIPELINES,
            KeyConditionExpression: 'orgId = :orgId',
            FilterExpression: 'isDefault = :t',
            ExpressionAttributeValues: { ':orgId': orgId, ':t': true },
        });
        return (Items?.[0] as Pipeline) ?? null;
    }

    async createPipeline(orgId: string, pipelineId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.PIPELINES, {
            orgId,
            pipelineId,
            sources: [],
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }

    async updatePipeline(orgId: string, pipelineId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = ['#updatedAt = :updatedAt'];
        const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
        const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };

        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }

        await this.ddb.update(Tables.PIPELINES, { orgId, pipelineId }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }

    async deletePipeline(orgId: string, pipelineId: string): Promise<void> {
        await this.ddb.delete(Tables.PIPELINES, { orgId, pipelineId });
    }
}
