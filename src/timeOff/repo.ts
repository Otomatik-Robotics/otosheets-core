import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { timeOffSk } from '../keys';
import { TimeOff } from './schema';

export class TimeOffRepo {
    constructor(private ddb: IDdb) {}

    async get(orgId: string, memberId: string, timeOffId: string): Promise<TimeOff | null> {
        const { Item } = await this.ddb.getItem(Tables.SCHEDULING, { orgId, sk: timeOffSk(memberId, timeOffId) });
        return (Item as TimeOff) ?? null;
    }

    async listByMember(orgId: string, memberId: string): Promise<TimeOff[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.SCHEDULING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `TIMEOFF#${memberId}#` },
        });
        return (Items as TimeOff[]) ?? [];
    }

    async listByOrg(orgId: string): Promise<TimeOff[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.SCHEDULING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'TIMEOFF#' },
        });
        return (Items as TimeOff[]) ?? [];
    }

    async create(orgId: string, memberId: string, timeOffId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.SCHEDULING, {
            orgId,
            sk: timeOffSk(memberId, timeOffId),
            timeOffId,
            memberId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }

    async update(orgId: string, memberId: string, timeOffId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = ['#updatedAt = :updatedAt'];
        const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
        const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };

        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }

        await this.ddb.update(Tables.SCHEDULING, { orgId, sk: timeOffSk(memberId, timeOffId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }

    async delete(orgId: string, memberId: string, timeOffId: string): Promise<void> {
        await this.ddb.delete(Tables.SCHEDULING, { orgId, sk: timeOffSk(memberId, timeOffId) });
    }
}
