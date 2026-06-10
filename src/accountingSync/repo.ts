import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { PaginatedResult } from '../types';
import { AccountingSync, AccountingSyncEntityType, AccountingSyncStatus } from './schema';

const skOf = (entityType: AccountingSyncEntityType, entityId: string) => `${entityType}#${entityId}`;

export class AccountingSyncRepo {
    constructor(private ddb: IDdb) {}

    async get(orgId: string, entityType: AccountingSyncEntityType, entityId: string): Promise<AccountingSync | null> {
        const { Item } = await this.ddb.getItem(Tables.ACCOUNTING_SYNC, { orgId, sk: skOf(entityType, entityId) });
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
            orgId,
            sk: skOf(entityType, entityId),
            entityType,
            entityId,
            ...data,
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
        await this.ddb.update(Tables.ACCOUNTING_SYNC, { orgId, sk: skOf(entityType, entityId) }, {
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
        const result = await this.ddb.query({
            TableName: Tables.ACCOUNTING_SYNC,
            KeyConditionExpression: 'orgId = :orgId',
            ...(status && { FilterExpression: '#status = :status' }),
            ...(status && { ExpressionAttributeNames: { '#status': 'status' } }),
            ExpressionAttributeValues: { ':orgId': orgId, ...(status && { ':status': status }) },
            Limit: limit,
            ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
        });
        return {
            items: (result.Items as AccountingSync[]) ?? [],
            lastEvaluatedKey: result.LastEvaluatedKey,
        };
    }

    async countByStatus(orgId: string, status: AccountingSyncStatus): Promise<number> {
        const { Count } = await this.ddb.query({
            TableName: Tables.ACCOUNTING_SYNC,
            KeyConditionExpression: 'orgId = :orgId',
            FilterExpression: '#status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':orgId': orgId, ':status': status },
            Select: 'COUNT',
        });
        return Count ?? 0;
    }
}
