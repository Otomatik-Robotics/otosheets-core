import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { statementSk } from '../keys';
import { Statement } from './schema';

export class StatementRepo {
    constructor(private ddb: IDdb) {}

    async getStatement(userId: string, fy: string, statementId: string): Promise<Statement | null> {
        const { Item } = await this.ddb.getItem(Tables.STATEMENTS, { userId, sk: statementSk(fy, statementId) });
        return (Item as Statement) ?? null;
    }

    async listStatements(userId: string, fy?: string): Promise<Statement[]> {
        const params: any = {
            TableName: Tables.STATEMENTS,
            KeyConditionExpression: fy
                ? 'userId = :userId AND begins_with(sk, :fy)'
                : 'userId = :userId',
            ExpressionAttributeValues: { ':userId': userId, ...(fy ? { ':fy': fy } : {}) },
        };
        const { Items } = await this.ddb.query(params);
        return (Items as Statement[]) ?? [];
    }

    async createStatement(userId: string, statementId: string, data: Record<string, any>): Promise<void> {
        await this.ddb.put(Tables.STATEMENTS, {
            userId,
            sk: statementSk(data.fy, statementId),
            statementId,
            ...data,
            createdAt: new Date().toISOString(),
        });
    }

    async deleteStatement(userId: string, fy: string, statementId: string): Promise<void> {
        await this.ddb.delete(Tables.STATEMENTS, { userId, sk: statementSk(fy, statementId) });
    }
}
