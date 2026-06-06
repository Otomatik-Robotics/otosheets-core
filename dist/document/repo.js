"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentRepo = void 0;
const tables_1 = require("../tables");
const docSk = (documentId) => `DOC#${documentId}`;
class DocumentRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async get(orgId, documentId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.ONBOARDING, { orgId, sk: docSk(documentId) });
        return Item ?? null;
    }
    async list(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'DOC#' },
        });
        return Items ?? [];
    }
    async create(orgId, doc) {
        const now = new Date().toISOString();
        const item = {
            orgId,
            sk: docSk(doc.documentId),
            ...doc,
            createdAt: now,
        };
        await this.ddb.put(tables_1.Tables.ONBOARDING, item);
        return item;
    }
    async update(orgId, documentId, updates) {
        const sets = [];
        const values = {};
        const names = {};
        if (updates.name !== undefined) {
            sets.push('#n = :name');
            values[':name'] = updates.name;
            names['#n'] = 'name';
        }
        if (updates.description !== undefined) {
            sets.push('description = :desc');
            values[':desc'] = updates.description;
        }
        if (updates.category !== undefined) {
            sets.push('category = :cat');
            values[':cat'] = updates.category;
        }
        if (sets.length === 0)
            return;
        sets.push('updatedAt = :now');
        values[':now'] = new Date().toISOString();
        await this.ddb.update(tables_1.Tables.ONBOARDING, { orgId, sk: docSk(documentId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeValues: values,
            ...(Object.keys(names).length > 0 ? { ExpressionAttributeNames: names } : {}),
        });
    }
    async delete(orgId, documentId) {
        await this.ddb.delete(tables_1.Tables.ONBOARDING, { orgId, sk: docSk(documentId) });
    }
}
exports.DocumentRepo = DocumentRepo;
//# sourceMappingURL=repo.js.map