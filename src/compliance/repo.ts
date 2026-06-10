import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { compliancePlaybookSk, complianceSettingsSk, complianceTaskSk } from '../keys';
import { CompliancePlaybook, ComplianceSettings, ComplianceTask } from './schema';

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

    async getTask(orgId: string, userId: string, taskId: string): Promise<ComplianceTask | null> {
        const { Item } = await this.ddb.getItem(Tables.ONBOARDING, { orgId, sk: complianceTaskSk(userId, taskId) });
        return (Item as ComplianceTask) ?? null;
    }

    /** Per-org register of items that carry an expiry date (DB-level filter). */
    async listTasksWithExpiry(orgId: string): Promise<ComplianceTask[]> {
        const items: ComplianceTask[] = [];
        let lastKey: Record<string, any> | undefined;
        do {
            const { Items, LastEvaluatedKey } = await this.ddb.query({
                TableName: Tables.ONBOARDING,
                KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
                FilterExpression: 'attribute_exists(expiryDate) AND expiryDate <> :empty',
                ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'TASK#', ':empty': '' },
                ExclusiveStartKey: lastKey,
            });
            items.push(...((Items as ComplianceTask[]) ?? []));
            lastKey = LastEvaluatedKey;
        } while (lastKey);
        return items;
    }

    /**
     * Cross-org scan of tasks with an expiry date on or before the cutoff.
     * Used by the daily renewal-reminder cron (no org context).
     */
    async scanTasksExpiringBy(cutoffDate: string): Promise<ComplianceTask[]> {
        const items: ComplianceTask[] = [];
        let lastKey: Record<string, any> | undefined;
        do {
            const { Items, LastEvaluatedKey } = await this.ddb.scan({
                TableName: Tables.ONBOARDING,
                FilterExpression: 'begins_with(sk, :prefix) AND attribute_exists(expiryDate) AND expiryDate <= :cutoff AND expiryDate <> :empty',
                ExpressionAttributeValues: { ':prefix': 'TASK#', ':cutoff': cutoffDate, ':empty': '' },
                ExclusiveStartKey: lastKey,
            });
            items.push(...((Items as ComplianceTask[]) ?? []));
            lastKey = LastEvaluatedKey;
        } while (lastKey);
        return items;
    }

    async getSettings(orgId: string): Promise<ComplianceSettings | null> {
        const { Item } = await this.ddb.getItem(Tables.ONBOARDING, { orgId, sk: complianceSettingsSk() });
        return (Item as ComplianceSettings) ?? null;
    }

    async putSettings(orgId: string, settings: Pick<ComplianceSettings, 'renewalDaysBefore' | 'renewalFrequencyDays' | 'notifyByEmail'>, updatedBy?: string): Promise<void> {
        await this.ddb.put(Tables.ONBOARDING, {
            orgId,
            sk: complianceSettingsSk(),
            ...settings,
            updatedBy,
            updatedAt: new Date().toISOString(),
        });
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
