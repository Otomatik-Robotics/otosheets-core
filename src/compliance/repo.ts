import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { compliancePlaybookSk, complianceTaskSk } from '../keys';
import { CompliancePlaybook, ComplianceTask } from './schema';

export class ComplianceRepo {
    constructor(private ddb: IDdb) {}

    async getPlaybook(orgId: string): Promise<CompliancePlaybook | null> {
        const { Item } = await this.ddb.getItem(Tables.ONBOARDING, { orgId, sk: compliancePlaybookSk() });
        return (Item as CompliancePlaybook) ?? null;
    }

    async putPlaybook(orgId: string, tasks: any, updatedBy?: string): Promise<void> {
        await this.ddb.put(Tables.ONBOARDING, {
            orgId,
            sk: compliancePlaybookSk(),
            tasks,
            updatedBy,
            updatedAt: new Date().toISOString(),
        });
    }

    async listTasks(orgId: string, userId?: string): Promise<ComplianceTask[]> {
        const prefix = userId ? `TASK#${userId}#` : 'TASK#';
        const { Items } = await this.ddb.query({
            TableName: Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': prefix },
        });
        return (Items as ComplianceTask[]) ?? [];
    }

    async createTask(orgId: string, userId: string, taskId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.ONBOARDING, {
            orgId,
            sk: complianceTaskSk(userId, taskId),
            taskId,
            userId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }

    async updateTask(orgId: string, userId: string, taskId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = ['#updatedAt = :updatedAt'];
        const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
        const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };

        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }

        await this.ddb.update(Tables.ONBOARDING, { orgId, sk: complianceTaskSk(userId, taskId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
}
