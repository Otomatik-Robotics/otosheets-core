import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { PaginatedResult } from '../types';
import { AccountingSync, AccountingSyncEntityType, AccountingSyncStatus } from './schema';

const skOf = (entityType: AccountingSyncEntityType, entityId: string) => `${entityType}#${entityId}`;

export class AccountingSyncRepo {
    constructor(private ddb: IDdb, private scope?: Readonly<{ orgId: string; businessProfileId: string }>) {}
    withScope(orgId: string, businessProfileId: string): AccountingSyncRepo {
        if (!orgId.trim() || !businessProfileId.trim()) throw new Error('Accounting sync scope is required');
        if (this.scope && (this.scope.orgId !== orgId || this.scope.businessProfileId !== businessProfileId)) throw new Error('Accounting sync scope cannot change');
        return new AccountingSyncRepo(this.ddb, Object.freeze({ orgId, businessProfileId }));
    }
    private key(orgId: string, entityType: AccountingSyncEntityType, entityId: string) {
        this.assertOrg(orgId);
        return `${this.scope ? this.prefix() : ''}${skOf(entityType, entityId)}`;
    }
    private prefix() { return `PROFILE#${this.scope!.businessProfileId}#`; }
    private assertOrg(orgId: string) {
        if (this.scope && this.scope.orgId !== orgId) throw new Error('Accounting sync organisation mismatch');
    }

    async get(orgId: string, entityType: AccountingSyncEntityType, entityId: string): Promise<AccountingSync | null> {
        const { Item } = await this.ddb.getItem(Tables.ACCOUNTING_SYNC, { orgId, sk: this.key(orgId, entityType, entityId) });
        return (Item as AccountingSync) ?? null;
    }

    async put(
        orgId: string,
        entityType: AccountingSyncEntityType,
        entityId: string,
        data: Partial<AccountingSync>,
    ): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.ACCOUNTING_SYNC, {
            ...data,
            orgId, sk: this.key(orgId, entityType, entityId), entityType, entityId,
            ...(this.scope ? { businessProfileId: this.scope.businessProfileId } : {}),
            createdAt: data.createdAt ?? now,
            updatedAt: now,
        });
    }

    async markFailed(
        orgId: string,
        entityType: AccountingSyncEntityType,
        entityId: string,
        error: string,
    ): Promise<void> {
        await this.ddb.update(Tables.ACCOUNTING_SYNC, { orgId, sk: this.key(orgId, entityType, entityId) }, {
            UpdateExpression: 'SET #status = :failed, #lastError = :error, #updatedAt = :now',
            ExpressionAttributeNames: { '#status': 'status', '#lastError': 'lastError', '#updatedAt': 'updatedAt' },
            ExpressionAttributeValues: { ':failed': 'FAILED', ':error': error, ':now': new Date().toISOString() },
        });
    }

    async listByOrg(params: {
        orgId: string;
        limit?: number;
        exclusiveStartKey?: Record<string, any>;
        status?: AccountingSyncStatus;
    }): Promise<PaginatedResult<AccountingSync>> {
        const { orgId, limit = 20, exclusiveStartKey, status } = params;
        this.assertOrg(orgId);
        const result = await this.ddb.query({
            TableName: Tables.ACCOUNTING_SYNC,
            KeyConditionExpression: this.scope ? 'orgId = :orgId AND begins_with(sk, :profile)' : 'orgId = :orgId',
            ...(status && { FilterExpression: '#status = :status' }),
            ...(status && { ExpressionAttributeNames: { '#status': 'status' } }),
            ExpressionAttributeValues: { ':orgId': orgId, ...(this.scope ? { ':profile': this.prefix() } : {}), ...(status && { ':status': status }) },
            Limit: limit,
            ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
        });
        return {
            items: (result.Items as AccountingSync[]) ?? [],
            lastEvaluatedKey: result.LastEvaluatedKey,
        };
    }

    async countByStatus(orgId: string, status: AccountingSyncStatus): Promise<number> {
        this.assertOrg(orgId);
        const { Count } = await this.ddb.query({
            TableName: Tables.ACCOUNTING_SYNC,
            KeyConditionExpression: this.scope ? 'orgId = :orgId AND begins_with(sk, :profile)' : 'orgId = :orgId',
            FilterExpression: '#status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':orgId': orgId, ...(this.scope ? { ':profile': this.prefix() } : {}), ':status': status },
            Select: 'COUNT',
        });
        return Count ?? 0;
    }
}
