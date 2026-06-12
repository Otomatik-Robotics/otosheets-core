import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { complianceChecklistSk, compliancePlaybookSk, complianceSettingsSk, complianceTaskSk, memberCertificationSk } from '../keys';
import { ComplianceChecklist, CompliancePlaybook, ComplianceSettings, ComplianceTask, MemberCertification } from './schema';

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

    // ─── Member certifications (mandatory checks with expiry) ─────────

    async putCertification(
        orgId: string,
        membershipId: string,
        certKey: string,
        data: Partial<Omit<MemberCertification, 'orgId' | 'sk' | 'membershipId' | 'certKey' | 'createdAt' | 'updatedAt'>>,
    ): Promise<void> {
        const now = new Date().toISOString();
        const existing = await this.getCertification(orgId, membershipId, certKey);
        await this.ddb.put(Tables.ONBOARDING, {
            ...existing,
            orgId,
            sk: memberCertificationSk(membershipId, certKey),
            membershipId,
            certKey,
            ...data,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        });
    }

    async getCertification(orgId: string, membershipId: string, certKey: string): Promise<MemberCertification | null> {
        const { Item } = await this.ddb.getItem(Tables.ONBOARDING, { orgId, sk: memberCertificationSk(membershipId, certKey) });
        return (Item as MemberCertification) ?? null;
    }

    /** All certifications for an org, or for a single member when membershipId is given. */
    async listCertifications(orgId: string, membershipId?: string): Promise<MemberCertification[]> {
        const prefix = membershipId ? `CERT#${membershipId}#` : 'CERT#';
        const items: MemberCertification[] = [];
        let lastKey: Record<string, any> | undefined;
        do {
            const { Items, LastEvaluatedKey } = await this.ddb.query({
                TableName: Tables.ONBOARDING,
                KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
                ExpressionAttributeValues: { ':orgId': orgId, ':prefix': prefix },
                ExclusiveStartKey: lastKey,
            });
            items.push(...((Items as MemberCertification[]) ?? []));
            lastKey = LastEvaluatedKey;
        } while (lastKey);
        return items;
    }

    async deleteCertification(orgId: string, membershipId: string, certKey: string): Promise<void> {
        await this.ddb.delete(Tables.ONBOARDING, { orgId, sk: memberCertificationSk(membershipId, certKey) });
    }

    /**
     * Cross-org scan of certifications expiring on or before the cutoff.
     * Used by the daily renewal-reminder cron (no org context).
     */
    async scanCertificationsExpiringBy(cutoffDate: string): Promise<MemberCertification[]> {
        const items: MemberCertification[] = [];
        let lastKey: Record<string, any> | undefined;
        do {
            const { Items, LastEvaluatedKey } = await this.ddb.scan({
                TableName: Tables.ONBOARDING,
                FilterExpression: 'begins_with(sk, :prefix) AND attribute_exists(expiry) AND expiry <= :cutoff AND expiry <> :empty',
                ExpressionAttributeValues: { ':prefix': 'CERT#', ':cutoff': cutoffDate, ':empty': '' },
                ExclusiveStartKey: lastKey,
            });
            items.push(...((Items as MemberCertification[]) ?? []));
            lastKey = LastEvaluatedKey;
        } while (lastKey);
        return items;
    }

    async getSettings(orgId: string): Promise<ComplianceSettings | null> {
        const { Item } = await this.ddb.getItem(Tables.ONBOARDING, { orgId, sk: complianceSettingsSk() });
        return (Item as ComplianceSettings) ?? null;
    }

    async putSettings(orgId: string, settings: Pick<ComplianceSettings, 'renewalDaysBefore' | 'renewalFrequencyDays' | 'notifyByEmail' | 'defaultAutoRenew'>, updatedBy?: string): Promise<void> {
        await this.ddb.put(Tables.ONBOARDING, {
            orgId,
            sk: complianceSettingsSk(),
            ...settings,
            updatedBy,
            updatedAt: new Date().toISOString(),
        });
    }

    // ─── Compliance checklists (named, assignable templates) ──────────

    async listChecklists(orgId: string): Promise<ComplianceChecklist[]> {
        const items: ComplianceChecklist[] = [];
        let lastKey: Record<string, any> | undefined;
        do {
            const { Items, LastEvaluatedKey } = await this.ddb.query({
                TableName: Tables.ONBOARDING,
                KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
                ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'CHECKLIST#' },
                ExclusiveStartKey: lastKey,
            });
            items.push(...((Items as ComplianceChecklist[]) ?? []));
            lastKey = LastEvaluatedKey;
        } while (lastKey);
        return items;
    }

    async getChecklist(orgId: string, checklistId: string): Promise<ComplianceChecklist | null> {
        const { Item } = await this.ddb.getItem(Tables.ONBOARDING, { orgId, sk: complianceChecklistSk(checklistId) });
        return (Item as ComplianceChecklist) ?? null;
    }

    async putChecklist(
        orgId: string,
        checklistId: string,
        data: Partial<Omit<ComplianceChecklist, 'orgId' | 'sk' | 'checklistId' | 'createdAt' | 'updatedAt'>>,
        updatedBy?: string,
    ): Promise<ComplianceChecklist> {
        const now = new Date().toISOString();
        const existing = await this.getChecklist(orgId, checklistId);
        const record: ComplianceChecklist = {
            ...(existing as ComplianceChecklist),
            ...(data as ComplianceChecklist),
            orgId,
            sk: complianceChecklistSk(checklistId),
            checklistId,
            createdAt: existing?.createdAt ?? now,
            createdBy: existing?.createdBy ?? updatedBy,
            updatedAt: now,
            updatedBy,
        } as ComplianceChecklist;
        await this.ddb.put(Tables.ONBOARDING, record);
        return record;
    }

    async deleteChecklist(orgId: string, checklistId: string): Promise<void> {
        await this.ddb.delete(Tables.ONBOARDING, { orgId, sk: complianceChecklistSk(checklistId) });
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
