import { resolveRoute, type Route } from '../dataBackend';
import { mirrorWrite, shadowRead } from '../dualWrite';
import { ddb } from '../ddbClient';
import type { IDdb } from '../ddbPort';
import { Pipeline } from './schema';
import { PipelineDynamoRepo, type IPipelineRepo } from './repo';
import { PipelinePgRepo } from './repo.pg';

const DOMAIN = 'leads' as const;
const ENTITY = 'pipeline';

export class RoutingPipelineRepo implements IPipelineRepo {
    constructor(private dynamo: IPipelineRepo, private pg: IPipelineRepo) {}
    private pick(r: Route): IPipelineRepo { return r.primary === 'dynamo' ? this.dynamo : this.pg; }
    private mirrorOf(r: Route): IPipelineRepo | undefined { return !r.mirror ? undefined : (r.mirror === 'dynamo' ? this.dynamo : this.pg); }
    private async mirrorEntity(route: Route, orgId: string, pipelineId: string, op: string): Promise<void> {
        const m = this.mirrorOf(route); if (!m) return;
        await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op, key: { orgId, pipelineId } }, async () => {
            const fresh = await this.pick(route).getPipeline(orgId, pipelineId);
            if (fresh) await m.upsertPipeline(fresh); else await m.deletePipeline(orgId, pipelineId);
        });
    }
    async getPipeline(orgId: string, pipelineId: string) {
        const r = await resolveRoute(DOMAIN); const res = await this.pick(r).getPipeline(orgId, pipelineId);
        if (r.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'getPipeline' }, res, () => this.pg.getPipeline(orgId, pipelineId)); return res;
    }
    async listPipelines(orgId: string) {
        const r = await resolveRoute(DOMAIN); const res = await this.pick(r).listPipelines(orgId);
        if (r.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'listPipelines' }, res, () => this.pg.listPipelines(orgId)); return res;
    }
    async scanAllPipelines() { return this.pick(await resolveRoute(DOMAIN)).scanAllPipelines(); }
    async getDefaultPipeline(orgId: string) {
        const r = await resolveRoute(DOMAIN); const res = await this.pick(r).getDefaultPipeline(orgId);
        if (r.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'getDefaultPipeline' }, res, () => this.pg.getDefaultPipeline(orgId)); return res;
    }
    async createPipeline(orgId: string, pipelineId: string, data: Record<string, any>) {
        const r = await resolveRoute(DOMAIN); await this.pick(r).createPipeline(orgId, pipelineId, data); await this.mirrorEntity(r, orgId, pipelineId, 'createPipeline');
    }
    async updatePipeline(orgId: string, pipelineId: string, updates: Record<string, any>) {
        const r = await resolveRoute(DOMAIN); await this.pick(r).updatePipeline(orgId, pipelineId, updates); await this.mirrorEntity(r, orgId, pipelineId, 'updatePipeline');
    }
    async deletePipeline(orgId: string, pipelineId: string) {
        const r = await resolveRoute(DOMAIN); await this.pick(r).deletePipeline(orgId, pipelineId);
        const m = this.mirrorOf(r); if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'deletePipeline', key: { orgId, pipelineId } }, () => m.deletePipeline(orgId, pipelineId));
    }
    async upsertPipeline(pipeline: Pipeline) {
        const r = await resolveRoute(DOMAIN); await this.pick(r).upsertPipeline(pipeline);
        const m = this.mirrorOf(r); if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'upsertPipeline', key: { orgId: pipeline.orgId, pipelineId: pipeline.pipelineId } }, () => m.upsertPipeline(pipeline));
    }
}

export class PipelineRepo extends RoutingPipelineRepo {
    constructor(dynamoDb: IDdb) { super(new PipelineDynamoRepo(dynamoDb), new PipelinePgRepo()); }
}
let singleton: IPipelineRepo | undefined;
export function getPipelineRepo(): IPipelineRepo { if (!singleton) singleton = new PipelineRepo(ddb); return singleton; }
