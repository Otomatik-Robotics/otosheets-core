import type { IDdb } from '../ddbPort';
import { Tables } from '../tables';

/** Durable admission/consumption for a signed OAuth state. No credentials are stored. */
export class OAuthStateRepo {
    constructor(private ddb: IDdb) {}
    async create(orgId: string, nonce: string, stateHash: string, expiresAt: number): Promise<void> {
        await this.ddb.update(Tables.INTEGRATIONS, { ownerId: `OAUTHSTATE#${orgId}`, provider: `oauth-state:${nonce}` }, {
            UpdateExpression: 'SET stateHash = :hash, expiresAt = :expires',
            ConditionExpression: 'attribute_not_exists(ownerId)',
            ExpressionAttributeValues: { ':hash': stateHash, ':expires': expiresAt },
        });
    }
    async consume(orgId: string, nonce: string, stateHash: string, now: number): Promise<boolean> {
        try {
            await this.ddb.update(Tables.INTEGRATIONS, { ownerId: `OAUTHSTATE#${orgId}`, provider: `oauth-state:${nonce}` }, {
                UpdateExpression: 'SET consumedAt = :now',
                ConditionExpression: 'attribute_exists(ownerId) AND stateHash = :hash AND expiresAt >= :now AND attribute_not_exists(consumedAt)',
                ExpressionAttributeValues: { ':hash': stateHash, ':now': now },
            });
            return true;
        } catch (error: any) {
            if (error?.name === 'ConditionalCheckFailedException') return false;
            throw error;
        }
    }
}
