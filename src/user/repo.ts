import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { User } from './schema';

export class UserRepo {
    constructor(private ddb: IDdb) {}

    async getUser(userId: string): Promise<User | null> {
        const { Item } = await this.ddb.getItem(Tables.USERS, { userId });
        return (Item as User) ?? null;
    }

    async getUserByEmail(email: string): Promise<User | null> {
        const { Items } = await this.ddb.query({
            TableName: Tables.USERS,
            IndexName: 'EmailIndex',
            KeyConditionExpression: 'email = :email',
            ExpressionAttributeValues: { ':email': email },
            Limit: 1,
        });
        return (Items?.[0] as User) ?? null;
    }

    async getUserBySlug(slug: string): Promise<User | null> {
        const { Items } = await this.ddb.query({
            TableName: Tables.USERS,
            IndexName: 'SlugIndex',
            KeyConditionExpression: 'slug = :slug',
            ExpressionAttributeValues: { ':slug': slug },
            Limit: 1,
        });
        return (Items?.[0] as User) ?? null;
    }

    async createUser(userId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.USERS, {
            userId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }

    async updateUser(userId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = ['#updatedAt = :updatedAt'];
        const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
        const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };

        for (const [key, val] of Object.entries(updates)) {
            const attr = `#${key}`;
            const placeholder = `:${key}`;
            sets.push(`${attr} = ${placeholder}`);
            names[attr] = key;
            values[placeholder] = val;
        }

        await this.ddb.update(Tables.USERS, { userId }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }

    async deleteUser(userId: string): Promise<void> {
        await this.ddb.delete(Tables.USERS, { userId });
    }
}
