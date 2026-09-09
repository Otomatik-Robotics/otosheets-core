import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import type { DocumentStored } from './schema';

const docSk = (documentId: string) => `DOC#${documentId}`;

export class DocumentRepo {
    constructor(private ddb: IDdb, private readonly scope?: Readonly<{ orgId: string; businessProfileId: string }>) {
        if (scope) {
            if (!scope.orgId?.trim() || !scope.businessProfileId?.trim()) throw new Error('Document scope is required');
            this.scope = Object.freeze({ ...scope });
        }
    }

    withScope(orgId: string, businessProfileId: string): DocumentRepo {
        if (!orgId?.trim() || !businessProfileId?.trim()) throw new Error('Document scope is required');
        if (this.scope && (this.scope.orgId !== orgId || this.scope.businessProfileId !== businessProfileId)) throw new Error('Document scope mismatch');
        return new DocumentRepo(this.ddb, { orgId, businessProfileId });
    }

    private assertOrg(orgId: string): void {
        if (this.scope && this.scope.orgId !== orgId) throw new Error('Document scope mismatch');
    }

    async get(orgId: string, documentId: string): Promise<DocumentStored | null> {
        this.assertOrg(orgId);
        const { Item } = await this.ddb.getItem(Tables.ONBOARDING, { orgId, sk: docSk(documentId) }, this.scope ? { ConsistentRead: true } : undefined);
        if (this.scope && (!Item || Item.orgId !== orgId || Item.businessProfileId !== this.scope.businessProfileId || Item.documentId !== documentId || Item.sk !== docSk(documentId))) return null;
        return (Item as DocumentStored) ?? null;
    }

    async list(orgId: string): Promise<DocumentStored[]> {
        this.assertOrg(orgId);
        if (this.scope) throw new Error('Scoped documents require listPage');
        const { Items } = await this.ddb.query({
            TableName: Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'DOC#' },
        });
        return (Items as DocumentStored[]) ?? [];
    }

    async listPage(orgId: string, options: { businessProfileId: string; limit?: number; nextToken?: string }): Promise<{ items: DocumentStored[]; nextToken?: string }> {
        this.assertOrg(orgId);
        if (this.scope && this.scope.businessProfileId !== options.businessProfileId) throw new Error('Document scope mismatch');
        if (!options.businessProfileId) throw new Error('Business profile is required');
        const scope = { orgId, businessProfileId: options.businessProfileId };
        let key: Record<string, any> | undefined;
        if (options.nextToken) {
            try {
                const token = JSON.parse(Buffer.from(options.nextToken, 'base64url').toString());
                if (token.orgId !== orgId || token.businessProfileId !== options.businessProfileId || token.key?.orgId !== orgId || !String(token.key?.sk).startsWith('DOC#')) throw new Error();
                key = token.key;
            } catch { throw new Error('Invalid document nextToken'); }
        }
        const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 20)));
        const page = await this.ddb.query({
            TableName: Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            FilterExpression: 'businessProfileId = :profile',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'DOC#', ':profile': options.businessProfileId },
            Limit: limit, ExclusiveStartKey: key,
        });
        return { items: (page.Items ?? []) as DocumentStored[], ...(page.LastEvaluatedKey ? { nextToken: Buffer.from(JSON.stringify({ ...scope, key: page.LastEvaluatedKey })).toString('base64url') } : {}) };
    }

    async create(orgId: string, doc: Omit<DocumentStored, 'orgId' | 'sk' | 'createdAt'>): Promise<DocumentStored> {
        this.assertOrg(orgId);
        if (this.scope && doc.businessProfileId !== undefined && doc.businessProfileId !== this.scope.businessProfileId) throw new Error('Document scope mismatch');
        const now = new Date().toISOString();
        const item: DocumentStored = {
            orgId,
            sk: docSk(doc.documentId),
            ...doc,
            ...(this.scope ? { orgId: this.scope.orgId, businessProfileId: this.scope.businessProfileId, sk: docSk(doc.documentId) } : {}),
            createdAt: now,
        };
        try {
            await this.ddb.transactWrite([{ Put: { TableName: Tables.ONBOARDING, Item: item, ConditionExpression: 'attribute_not_exists(sk)' } }]);
            return item;
        } catch (error) {
            if ((error as Error).name !== 'TransactionCanceledException' && (error as Error).name !== 'ConditionalCheckFailedException') throw error;
            const existing = await this.get(orgId, doc.documentId);
            if (!existing || existing.businessProfileId !== (this.scope?.businessProfileId ?? doc.businessProfileId) || existing.s3Key !== doc.s3Key) throw new Error('Document ID already exists');
            return existing;
        }
    }

    async update(orgId: string, documentId: string, updates: Partial<Pick<DocumentStored, 'name' | 'description' | 'category'>>): Promise<void> {
        this.assertOrg(orgId);
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

        if (this.scope) values[':profile'] = this.scope.businessProfileId;
        await this.ddb.update(Tables.ONBOARDING, { orgId, sk: docSk(documentId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ...(this.scope ? { ConditionExpression: 'attribute_exists(sk) AND businessProfileId = :profile' } : {}),
            ExpressionAttributeValues: values,
            ...(Object.keys(names).length > 0 ? { ExpressionAttributeNames: names } : {}),
        });
    }

    async delete(orgId: string, documentId: string): Promise<void> {
        this.assertOrg(orgId);
        if (this.scope) {
            await this.ddb.transactWrite([{ Delete: { TableName: Tables.ONBOARDING, Key: { orgId, sk: docSk(documentId) }, ConditionExpression: 'attribute_exists(sk) AND businessProfileId = :profile', ExpressionAttributeValues: { ':profile': this.scope.businessProfileId } } }]);
            return;
        }
        await this.ddb.delete(Tables.ONBOARDING, { orgId, sk: docSk(documentId) });
    }
}
