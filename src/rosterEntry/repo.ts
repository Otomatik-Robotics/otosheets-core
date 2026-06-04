import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { rosterEntrySk } from '../keys';
import { RosterEntry } from './schema';

export class RosterEntryRepo {
    constructor(private ddb: IDdb) {}

    async get(orgId: string, date: string, memberId: string): Promise<RosterEntry | null> {
        const { Item } = await this.ddb.getItem(Tables.SCHEDULING, { orgId, sk: rosterEntrySk(date, memberId) });
        return (Item as RosterEntry) ?? null;
    }

    async listByDateRange(orgId: string, from: string, to: string): Promise<RosterEntry[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.SCHEDULING,
            KeyConditionExpression: 'orgId = :orgId AND sk BETWEEN :from AND :to',
            ExpressionAttributeValues: {
                ':orgId': orgId,
                ':from': `ROSTER#${from}`,
                ':to': `ROSTER#${to}￿`,
            },
        });
        return (Items as RosterEntry[]) ?? [];
    }

    async listByDate(orgId: string, date: string): Promise<RosterEntry[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.SCHEDULING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `ROSTER#${date}#` },
        });
        return (Items as RosterEntry[]) ?? [];
    }

    async create(orgId: string, rosterId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.SCHEDULING, {
            orgId,
            sk: rosterEntrySk(data.date, data.memberId),
            rosterId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }

    async update(orgId: string, date: string, memberId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = ['#updatedAt = :updatedAt'];
        const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
        const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };

        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }

        await this.ddb.update(Tables.SCHEDULING, { orgId, sk: rosterEntrySk(date, memberId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }

    async delete(orgId: string, date: string, memberId: string): Promise<void> {
        await this.ddb.delete(Tables.SCHEDULING, { orgId, sk: rosterEntrySk(date, memberId) });
    }

    async batchCreate(orgId: string, entries: Array<{ rosterId: string } & Record<string, any>>): Promise<void> {
        if (entries.length === 0) return;
        const now = new Date().toISOString();

        const putRequests = entries.map(entry => ({
            PutRequest: {
                Item: {
                    orgId,
                    sk: rosterEntrySk(entry.date, entry.memberId),
                    ...entry,
                    createdAt: now,
                    updatedAt: now,
                },
            },
        }));

        // DynamoDB batch write max 25 items per request
        for (let i = 0; i < putRequests.length; i += 25) {
            const batch = putRequests.slice(i, i + 25);
            await this.ddb.batchWrite({ [Tables.SCHEDULING]: batch });
        }
    }

    async bulkUpdateStatus(orgId: string, entries: Array<{ date: string; memberId: string }>, status: string): Promise<void> {
        const now = new Date().toISOString();
        const transactItems = entries.map(entry => ({
            Update: {
                TableName: Tables.SCHEDULING,
                Key: { orgId, sk: rosterEntrySk(entry.date, entry.memberId) },
                UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt',
                ExpressionAttributeNames: { '#status': 'status', '#updatedAt': 'updatedAt' },
                ExpressionAttributeValues: { ':status': status, ':updatedAt': now },
            },
        }));

        // DynamoDB transact write max 100 items per request
        for (let i = 0; i < transactItems.length; i += 100) {
            const batch = transactItems.slice(i, i + 100);
            await this.ddb.transactWrite(batch);
        }
    }
}
