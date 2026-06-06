import { IDdb } from '../ddbPort';
import { Statement } from './schema';
export declare class StatementRepo {
    private ddb;
    constructor(ddb: IDdb);
    getStatement(userId: string, fy: string, statementId: string): Promise<Statement | null>;
    listStatements(userId: string, fy?: string): Promise<Statement[]>;
    createStatement(userId: string, statementId: string, data: Record<string, any>): Promise<void>;
    deleteStatement(userId: string, fy: string, statementId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map