import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { onboardingRunSk } from '../keys';
import { OnboardingRun } from './schema';

export class OnboardingRunRepo {
    constructor(private ddb: IDdb) {}

    async get(orgId: string, membershipId: string): Promise<OnboardingRun | null> {
        const { Item } = await this.ddb.getItem(Tables.ONBOARDING, {
            orgId,
            sk: onboardingRunSk(membershipId),
        });
        return (Item as OnboardingRun) ?? null;
    }

    async list(orgId: string): Promise<OnboardingRun[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'ONBOARDING#' },
        });
        return (Items as OnboardingRun[]) ?? [];
    }

    async put(orgId: string, run: Omit<OnboardingRun, 'orgId' | 'sk'>): Promise<void> {
        await this.ddb.put(Tables.ONBOARDING, {
            orgId,
            sk: onboardingRunSk(run.membershipId),
            ...run,
        });
    }

    async update(orgId: string, membershipId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = [];
        const names: Record<string, string> = {};
        const values: Record<string, any> = {};

        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }

        await this.ddb.update(Tables.ONBOARDING, { orgId, sk: onboardingRunSk(membershipId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
}
