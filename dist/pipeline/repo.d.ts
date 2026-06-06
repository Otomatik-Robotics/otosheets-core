import { IDdb } from '../ddbPort';
import { Pipeline } from './schema';
export declare class PipelineRepo {
    private ddb;
    constructor(ddb: IDdb);
    getPipeline(orgId: string, pipelineId: string): Promise<Pipeline | null>;
    listPipelines(orgId: string): Promise<Pipeline[]>;
    getDefaultPipeline(orgId: string): Promise<Pipeline | null>;
    createPipeline(orgId: string, pipelineId: string, data: Record<string, any>): Promise<void>;
    updatePipeline(orgId: string, pipelineId: string, updates: Record<string, any>): Promise<void>;
    deletePipeline(orgId: string, pipelineId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map