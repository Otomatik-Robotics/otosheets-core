import { createHash, randomUUID } from 'node:crypto';
import type { IDdb } from '../ddbPort';
import { notificationScope, type NotificationScope } from '../notification/contract';

export interface ScopedPushDevice {
    userId: string; token: string; platform: 'ios' | 'android'; endpointArn: string;
    organizationId: string; businessProfileId: string; bindingVersion: string;
}

/** One physical token has one current user/profile binding; legacy rows cannot receive scoped push. */
export class PushDeviceRepo {
    constructor(private ddb: IDdb, private table: string) {
        if (!table) throw new Error('Push device table is required');
    }
    private keys(token: string) {
        if (!token) throw new Error('Push token is required');
        const hash = createHash('sha256').update(token).digest('hex');
        return { deviceToken: `v2#${hash}`, binding: { userId: `push-token#${hash}`, token: 'binding' } };
    }
    async register(userId: string, token: string, platform: 'ios' | 'android', endpointArn: string, scope: NotificationScope): Promise<void> {
        notificationScope(scope.orgId, scope.businessProfileId);
        if (!userId || userId.startsWith('push-token#') || !endpointArn || !['ios', 'android'].includes(platform)) throw new Error('Invalid push device');
        const keys = this.keys(token);
        const { Item: previous } = await this.ddb.getItem(this.table, keys.binding, { ConsistentRead: true });
        const version = randomUUID();
        const device: ScopedPushDevice = { userId, token: keys.deviceToken, platform, endpointArn,
            organizationId: scope.orgId, businessProfileId: scope.businessProfileId, bindingVersion: version };
        await this.ddb.transactWrite([
            { Put: { TableName: this.table,
                Item: { ...keys.binding, principalId: userId, organizationId: scope.orgId, businessProfileId: scope.businessProfileId, endpointArn, bindingVersion: version },
                ConditionExpression: previous ? 'bindingVersion = :previous' : 'attribute_not_exists(token)',
                ...(previous ? { ExpressionAttributeValues: { ':previous': previous.bindingVersion } } : {}) } },
            { Put: { TableName: this.table, Item: device } },
        ]);
    }
    async list(userId: string, scope: NotificationScope): Promise<ScopedPushDevice[]> {
        notificationScope(scope.orgId, scope.businessProfileId);
        const devices: ScopedPushDevice[] = [];
        let after: Record<string, any> | undefined;
        do {
            const page = await this.ddb.query({ TableName: this.table, KeyConditionExpression: 'userId = :user',
                FilterExpression: 'organizationId = :org AND businessProfileId = :profile AND attribute_exists(bindingVersion)',
                ExpressionAttributeValues: { ':user': userId, ':org': scope.orgId, ':profile': scope.businessProfileId },
                Limit: 100, ...(after ? { ExclusiveStartKey: after } : {}) });
            for (const item of page.Items ?? []) {
                if (item.userId !== userId || item.organizationId !== scope.orgId || item.businessProfileId !== scope.businessProfileId
                    || typeof item.token !== 'string' || !/^v2#[a-f0-9]{64}$/.test(item.token) || !item.bindingVersion) continue;
                const { Item: binding } = await this.ddb.getItem(this.table, { userId: `push-token#${item.token.slice(3)}`, token: 'binding' }, { ConsistentRead: true });
                if (binding?.principalId === userId && binding.organizationId === scope.orgId && binding.businessProfileId === scope.businessProfileId
                    && binding.bindingVersion === item.bindingVersion && binding.endpointArn === item.endpointArn) devices.push(item as ScopedPushDevice);
            }
            after = page.LastEvaluatedKey;
        } while (after);
        return devices;
    }
    async unregister(userId: string, token: string, scope: NotificationScope): Promise<void> {
        notificationScope(scope.orgId, scope.businessProfileId);
        const keys = this.keys(token);
        const { Item: binding } = await this.ddb.getItem(this.table, keys.binding, { ConsistentRead: true });
        if (binding?.principalId !== userId || binding.organizationId !== scope.orgId || binding.businessProfileId !== scope.businessProfileId) return;
        await this.removeIfCurrent({ userId, token: keys.deviceToken, organizationId: scope.orgId, businessProfileId: scope.businessProfileId,
            bindingVersion: binding.bindingVersion, endpointArn: binding.endpointArn, platform: 'ios' });
    }
    async removeIfCurrent(device: ScopedPushDevice): Promise<void> {
        if (!/^v2#[a-f0-9]{64}$/.test(device.token)) throw new Error('Invalid push device binding');
        try {
            await this.ddb.transactWrite([
                { Delete: { TableName: this.table, Key: { userId: `push-token#${device.token.slice(3)}`, token: 'binding' },
                    ConditionExpression: 'bindingVersion = :version AND principalId = :user AND organizationId = :org AND businessProfileId = :profile',
                    ExpressionAttributeValues: { ':version': device.bindingVersion, ':user': device.userId, ':org': device.organizationId, ':profile': device.businessProfileId } } },
                { Delete: { TableName: this.table, Key: { userId: device.userId, token: device.token } } },
            ]);
        } catch (error) {
            const failure = error as { name?: string; CancellationReasons?: Array<{ Code?: string }> };
            if (failure.name !== 'TransactionCanceledException' || failure.CancellationReasons?.[0]?.Code !== 'ConditionalCheckFailed') throw error;
        }
    }
}
