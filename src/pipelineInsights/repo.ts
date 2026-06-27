import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { PipelineInsightsSnapshot } from './schema';

export class PipelineInsightsRepo {
    constructor(private ddb: IDdb) {}

    async getSnapshot(orgId: string, pipelineId: string): Promise<PipelineInsightsSnapshot | null> {
        const { Item } = await this.ddb.getItem(Tables.PIPELINE_INSIGHTS, { orgId, pipelineId });
        return (Item as PipelineInsightsSnapshot) ?? null;
    }

    async putSnapshot(snapshot: PipelineInsightsSnapshot): Promise<void> {
        await this.ddb.put(Tables.PIPELINE_INSIGHTS, snapshot);
    }
}
