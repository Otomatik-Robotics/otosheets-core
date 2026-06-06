"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserRepo = void 0;
const tables_1 = require("../tables");
class UserRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getUser(userId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.USERS, { userId });
        return Item ?? null;
    }
    async getUserByEmail(email) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.USERS,
            IndexName: 'EmailIndex',
            KeyConditionExpression: 'email = :email',
            ExpressionAttributeValues: { ':email': email },
            Limit: 1,
        });
        return Items?.[0] ?? null;
    }
    async getUserBySlug(slug) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.USERS,
            IndexName: 'SlugIndex',
            KeyConditionExpression: 'slug = :slug',
            ExpressionAttributeValues: { ':slug': slug },
            Limit: 1,
        });
        return Items?.[0] ?? null;
    }
    async createUser(userId, data) {
        const now = new Date().toISOString();
        await this.ddb.put(tables_1.Tables.USERS, {
            userId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }
    async updateUser(userId, updates) {
        const sets = ['#updatedAt = :updatedAt'];
        const names = { '#updatedAt': 'updatedAt' };
        const values = { ':updatedAt': new Date().toISOString() };
        for (const [key, val] of Object.entries(updates)) {
            const attr = `#${key}`;
            const placeholder = `:${key}`;
            sets.push(`${attr} = ${placeholder}`);
            names[attr] = key;
            values[placeholder] = val;
        }
        await this.ddb.update(tables_1.Tables.USERS, { userId }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
    async deleteUser(userId) {
        await this.ddb.delete(tables_1.Tables.USERS, { userId });
    }
}
exports.UserRepo = UserRepo;
//# sourceMappingURL=repo.js.map