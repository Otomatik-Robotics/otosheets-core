import { IDdb } from '../ddbPort';
import { WelcomeEmailTemplate } from './schema';
export declare class WelcomeEmailRepo {
    private ddb;
    constructor(ddb: IDdb);
    get(orgId: string, templateId: string): Promise<WelcomeEmailTemplate | null>;
    list(orgId: string): Promise<WelcomeEmailTemplate[]>;
    put(orgId: string, template: Omit<WelcomeEmailTemplate, 'orgId' | 'sk'>): Promise<void>;
    delete(orgId: string, templateId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map