import { createHash, randomUUID } from 'node:crypto';
import type { IDdb } from '../ddbPort';
import { notificationScope, type NotificationScope } from '../notification/contract';

export interface ScopedPushDevice {
    userId: string; token: string; platform: 'ios' | 'android'; endpointArn: string;
    organizationId: string; businessProfileId: string; bindingVersion: string; generation: number;
}
export interface PushRegistrationLease {
    userId: string; token: string; organizationId: string; businessProfileId: string;
    bindingVersion: string; generation: number; expiresAt: number;
}

/** A durable device generation orders intents across app restarts; tombstones retain its high-water mark. */
export class PushDeviceRepo {
    constructor(private ddb: IDdb, private table: string, private now = () => Math.floor(Date.now() / 1000)) {
        if (!table) throw new Error('Push device table is required');
    }
    private keys(token: string) {
        if (!token) throw new Error('Push token is required');
        const hash = createHash('sha256').update(token).digest('hex');
        return { deviceToken: `v2#${hash}`, binding: { userId: `push-token#${hash}`, token: 'binding' } };
    }
    private validate(userId: string, scope: NotificationScope, generation: number) {
        notificationScope(scope.orgId, scope.businessProfileId);
        if (!userId || userId.startsWith('push-token#') || !Number.isSafeInteger(generation) || generation < 1) throw new Error('Invalid push device generation');
    }
    private bindingKey(token: string) {
        if (!/^v2#[a-f0-9]{64}$/.test(token)) throw new Error('Invalid push device binding');
        return { userId: `push-token#${token.slice(3)}`, token: 'binding' };
    }
    /** Reserve before provider work. A delayed lower generation cannot reserve after a newer runtime. */
    async beginRegistration(userId: string, token: string, scope: NotificationScope, generation: number): Promise<PushRegistrationLease> {
        this.validate(userId, scope, generation);
        const keys = this.keys(token);
        const lease: PushRegistrationLease = { userId, token: keys.deviceToken, organizationId: scope.orgId,
            businessProfileId: scope.businessProfileId, bindingVersion: randomUUID(), generation, expiresAt: this.now() + 60 };
        await this.ddb.transactWrite([{ Put: { TableName: this.table,
            Item: { ...keys.binding, principalId: userId, organizationId: scope.orgId, businessProfileId: scope.businessProfileId,
                bindingVersion: lease.bindingVersion, generation, highWater: generation, expiresAt: lease.expiresAt, state: 'pending' },
            ConditionExpression: 'attribute_not_exists(highWater) OR highWater < :generation',
            ExpressionAttributeValues: { ':generation': generation } } }]);
        return lease;
    }
    /** Provider completion cannot overwrite a newer reservation, logout tombstone or expired lease. */
    async completeRegistration(lease: PushRegistrationLease, platform: 'ios' | 'android', endpointArn: string): Promise<void> {
        if (!endpointArn || !['ios', 'android'].includes(platform)) throw new Error('Invalid push device');
        const device: ScopedPushDevice = { ...lease, platform, endpointArn };
        await this.ddb.transactWrite([
            { Put: { TableName: this.table,
                Item: { ...this.bindingKey(lease.token), principalId: lease.userId, organizationId: lease.organizationId,
                    businessProfileId: lease.businessProfileId, bindingVersion: lease.bindingVersion, generation: lease.generation, highWater: lease.generation,
                    expiresAt: lease.expiresAt, state: 'active', endpointArn },
                ConditionExpression: 'bindingVersion = :version AND highWater = :generation AND generation = :generation AND expiresAt > :now',
                ExpressionAttributeValues: { ':version': lease.bindingVersion, ':generation': lease.generation, ':now': this.now() } } },
            { Put: { TableName: this.table, Item: device } },
        ]);
    }
    async register(userId: string, token: string, platform: 'ios' | 'android', endpointArn: string, scope: NotificationScope, generation: number): Promise<void> {
        const lease = await this.beginRegistration(userId, token, scope, generation);
        await this.completeRegistration(lease, platform, endpointArn);
    }
    async list(userId: string, scope: NotificationScope): Promise<ScopedPushDevice[]> {
        notificationScope(scope.orgId, scope.businessProfileId);
        const devices: ScopedPushDevice[] = [];
        let after: Record<string, any> | undefined;
        do {
            const page = await this.ddb.query({ TableName: this.table, KeyConditionExpression: 'userId = :user',
                FilterExpression: 'organizationId = :org AND businessProfileId = :profile AND attribute_exists(generation)',
                ExpressionAttributeValues: { ':user': userId, ':org': scope.orgId, ':profile': scope.businessProfileId },
                Limit: 100, ...(after ? { ExclusiveStartKey: after } : {}) });
            for (const item of page.Items ?? []) {
                if (item.userId !== userId || item.organizationId !== scope.orgId || item.businessProfileId !== scope.businessProfileId
                    || typeof item.token !== 'string' || !/^v2#[a-f0-9]{64}$/.test(item.token) || !item.bindingVersion || !Number.isSafeInteger(item.generation)) continue;
                const { Item: binding } = await this.ddb.getItem(this.table, this.bindingKey(item.token), { ConsistentRead: true });
                if (binding?.state === 'active' && binding.principalId === userId && binding.organizationId === scope.orgId && binding.businessProfileId === scope.businessProfileId
                    && binding.bindingVersion === item.bindingVersion && binding.generation === item.generation && binding.endpointArn === item.endpointArn) devices.push(item as ScopedPushDevice);
            }
            after = page.LastEvaluatedKey;
        } while (after);
        return devices;
    }
    async unregister(userId: string, token: string, scope: NotificationScope, generation: number): Promise<void> {
        this.validate(userId, scope, generation);
        const keys = this.keys(token);
        for (let attempt = 0; attempt < 5; attempt++) {
            const { Item: current } = await this.ddb.getItem(this.table, keys.binding, { ConsistentRead: true });
            if ((current?.highWater ?? 0) > generation) return;
            const owned = current?.principalId === userId && current.organizationId === scope.orgId && current.businessProfileId === scope.businessProfileId;
            if (current?.highWater === generation && (!owned || current.state === 'revoked')) return;
            // A foreign active binding stays active, but cannot erase this newer device-intent barrier.
            const next = current && !owned ? { ...current, highWater: generation } : {
                ...keys.binding, principalId: userId, organizationId: scope.orgId, businessProfileId: scope.businessProfileId,
                generation, highWater: generation, bindingVersion: randomUUID(), state: 'revoked',
            };
            try {
                await this.ddb.transactWrite([{ Put: { TableName: this.table, Item: next,
                    ConditionExpression: current ? 'highWater = :previous AND bindingVersion = :version' : 'attribute_not_exists(token)',
                    ...(current ? { ExpressionAttributeValues: { ':previous': current.highWater, ':version': current.bindingVersion } } : {}) } }]);
                return;
            } catch (error) { if (!this.conditionalFailure(error)) throw error; }
        }
        throw new Error('Push revocation conflicted; retry with the same generation');
    }
    async removeIfCurrent(device: ScopedPushDevice): Promise<void> {
        const key = this.bindingKey(device.token);
        const { Item: current } = await this.ddb.getItem(this.table, key, { ConsistentRead: true });
        if (current?.bindingVersion !== device.bindingVersion || current.principalId !== device.userId
            || current.organizationId !== device.organizationId || current.businessProfileId !== device.businessProfileId) return;
        try {
            await this.ddb.transactWrite([{ Put: { TableName: this.table,
                Item: { ...current, bindingVersion: randomUUID(), state: 'revoked' },
                ConditionExpression: 'bindingVersion = :version AND highWater = :previous',
                ExpressionAttributeValues: { ':version': device.bindingVersion, ':previous': current.highWater } } }]);
        } catch (error) { if (!this.conditionalFailure(error)) throw error; }
    }
    private conditionalFailure(error: unknown): boolean {
        const failure = error as { name?: string; CancellationReasons?: Array<{ Code?: string }> };
        return failure.name === 'TransactionCanceledException' && failure.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed';
    }
}
