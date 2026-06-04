import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { rotationSk } from '../keys';
import { Rotation } from './schema';

export class RotationRepo {
    constructor(private ddb: IDdb) {}

    async get(orgId: string, rotationId: string): Promise<Rotation | null> {
        const { Item } = await this.ddb.getItem(Tables.SCHEDULING, { orgId, sk: rotationSk(rotationId) });
        return (Item as Rotation) ?? null;
    }

    async listByOrg(orgId: string): Promise<Rotation[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.SCHEDULING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'ROTATION#' },
        });
        return (Items as Rotation[]) ?? [];
    }

    async create(orgId: string, rotationId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.SCHEDULING, {
            orgId,
            sk: rotationSk(rotationId),
            rotationId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }

    async update(orgId: string, rotationId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = ['#updatedAt = :updatedAt'];
        const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
        const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };

        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }

        await this.ddb.update(Tables.SCHEDULING, { orgId, sk: rotationSk(rotationId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }

    async delete(orgId: string, rotationId: string): Promise<void> {
        await this.ddb.delete(Tables.SCHEDULING, { orgId, sk: rotationSk(rotationId) });
    }
}
