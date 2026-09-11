import { randomUUID } from 'node:crypto';
import type { IDdb } from '../ddbPort';

export interface AdvisorAuditEntry {
    advisorUserId: string;
    advisorName?: string;
    action: string;
    targetType?: string;
    targetId?: string;
    detail?: Record<string, unknown>;
}
export interface AdvisorAuditRecord extends AdvisorAuditEntry {
    auditId: string;
    orgId: string;
    businessProfileId: string;
    createdAt: string;
    ttl: number;
}

/** Business audit records use a separate key namespace; legacy org-wide records stay quarantined. */
export class AdvisorAuditRepo {
    private readonly scope: Readonly<{ orgId: string; businessProfileId: string }>;
    constructor(private readonly ddb: IDdb, private readonly table: string,
        scope: { orgId: string; businessProfileId: string }, private readonly now: () => number = Date.now) {
        if (!table?.trim() || !scope.orgId?.trim() || !scope.businessProfileId?.trim()) throw new Error('Advisor audit table and scope are required');
        this.scope = Object.freeze({ orgId: scope.orgId, businessProfileId: scope.businessProfileId });
    }
    private get pk() { return `ORG#${this.scope.orgId}`; }
    private get prefix() { return `PROFILE#${Buffer.from(this.scope.businessProfileId).toString('base64url')}#AUDIT#`; }
    private validId(id: string) { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z#[a-f0-9-]{36}$/.test(id); }
    private cursor(token: string): { pk: string; sk: string } {
        try {
            if (token.length > 4096) throw new Error();
            const decoded = Buffer.from(token, 'base64url');
            if (decoded.toString('base64url') !== token) throw new Error();
            const value = JSON.parse(decoded.toString('utf8'));
            if (Object.keys(value).sort().join(',') !== 'pk,sk' || value.pk !== this.pk
                || typeof value.sk !== 'string' || !value.sk.startsWith(this.prefix)
                || !this.validId(value.sk.slice(this.prefix.length))) throw new Error();
            return { pk: value.pk, sk: value.sk };
        } catch { throw new Error('Invalid advisor audit cursor'); }
    }
    async append(entry: AdvisorAuditEntry): Promise<AdvisorAuditRecord> {
        if (!entry.advisorUserId?.trim() || !entry.action?.trim()) throw new Error('Advisor audit actor and action are required');
        const now = this.now();
        const createdAt = new Date(now).toISOString();
        const auditId = `${createdAt}#${randomUUID()}`;
        const record: AdvisorAuditRecord = {
            advisorUserId: entry.advisorUserId, advisorName: entry.advisorName,
            action: entry.action, targetType: entry.targetType, targetId: entry.targetId, detail: entry.detail,
            auditId, ...this.scope, createdAt, ttl: Math.floor(now / 1000) + 400 * 86400,
        };
        await this.ddb.transactWrite([{ Put: { TableName: this.table,
            Item: { ...record, pk: this.pk, sk: this.prefix + auditId },
            ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' } }]);
        return record;
    }
    async get(auditId: string): Promise<AdvisorAuditRecord | null> {
        if (!this.validId(auditId)) return null;
        const sk = this.prefix + auditId;
        const { Item } = await this.ddb.getItem(this.table, { pk: this.pk, sk }, { ConsistentRead: true });
        if (!Item || Item.pk !== this.pk || Item.sk !== sk || Item.orgId !== this.scope.orgId
            || Item.businessProfileId !== this.scope.businessProfileId || !(Item.ttl > Math.floor(this.now() / 1000))) return null;
        const { pk: _pk, sk: _sk, ...record } = Item;
        return record as AdvisorAuditRecord;
    }
    async list(opts: { limit?: number; nextToken?: string | null } = {}): Promise<{ items: AdvisorAuditRecord[]; nextToken: string | null }> {
        const limit = opts.limit ?? 20;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Advisor audit limit must be between 1 and 100');
        const { Items, LastEvaluatedKey } = await this.ddb.query({
            TableName: this.table,
            KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
            FilterExpression: 'orgId = :org AND businessProfileId = :profile AND #ttl > :now',
            ExpressionAttributeNames: { '#ttl': 'ttl' },
            ExpressionAttributeValues: { ':pk': this.pk, ':prefix': this.prefix, ':org': this.scope.orgId,
                ':profile': this.scope.businessProfileId, ':now': Math.floor(this.now() / 1000) },
            ConsistentRead: true, ScanIndexForward: false, Limit: limit,
            ExclusiveStartKey: opts.nextToken ? this.cursor(opts.nextToken) : undefined,
        });
        const nextToken = LastEvaluatedKey ? Buffer.from(JSON.stringify({ pk: LastEvaluatedKey.pk, sk: LastEvaluatedKey.sk })).toString('base64url') : null;
        if (nextToken) this.cursor(nextToken);
        return { items: (Items ?? []).map(({ pk: _pk, sk: _sk, ...record }) => record as AdvisorAuditRecord), nextToken };
    }
}
