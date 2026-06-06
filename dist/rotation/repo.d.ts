import { IDdb } from '../ddbPort';
import { Rotation } from './schema';
export declare class RotationRepo {
    private ddb;
    constructor(ddb: IDdb);
    get(orgId: string, rotationId: string): Promise<Rotation | null>;
    listByOrg(orgId: string): Promise<Rotation[]>;
    create(orgId: string, rotationId: string, data: Record<string, any>): Promise<void>;
    update(orgId: string, rotationId: string, updates: Record<string, any>): Promise<void>;
    delete(orgId: string, rotationId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map