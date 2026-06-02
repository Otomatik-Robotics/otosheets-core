import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import type { DocumentStored } from './schema';

const docSk = (documentId: string) => `DOC#${documentId}`;

export class DocumentRepo {
    constructor(private ddb: IDdb) {}

    async get(orgId: string, documentId: string): Promise<DocumentStored | null> {
        const { Item } = await this.ddb.getItem(Tables.ONBOARDING, { orgId, sk: docSk(documentId) });
        return (Item as DocumentStored) ?? null;
    }

    async list(orgId: string): Promise<DocumentStored[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'DOC#' },
        });
        return (Items as DocumentStored[]) ?? [];
    }

    async create(orgId: string, doc: Omit<DocumentStored, 'orgId' | 'sk' | 'createdAt'>): Promise<DocumentStored> {
        const now = new Date().toISOString();
        const item: DocumentStored = {
            orgId,
            sk: docSk(doc.documentId),
            ...doc,
            createdAt: now,
        };
        await this.ddb.put(Tables.ONBOARDING, item);
        return item;
    }

    async update(orgId: string, documentId: string, updates: Partial<Pick<DocumentStored, 'name' | 'description' | 'category'>>): Promise<void> {
        const sets: string[] = [];
        const values: Record<string, unknown> = {};
        const names: Record<string, string> = {};

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

        if (sets.length === 0) return;

        sets.push('updatedAt = :now');
        values[':now'] = new Date().toISOString();

        await this.ddb.update(Tables.ONBOARDING, { orgId, sk: docSk(documentId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeValues: values,
            ...(Object.keys(names).length > 0 ? { ExpressionAttributeNames: names } : {}),
        });
    }

    async delete(orgId: string, documentId: string): Promise<void> {
        await this.ddb.delete(Tables.ONBOARDING, { orgId, sk: docSk(documentId) });
    }
}
