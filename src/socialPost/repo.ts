import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { SOCIAL_POST_DUE_KEY, SocialPost } from './schema';

export class SocialPostRepo {
    constructor(private ddb: IDdb) {}

    async getPost(orgId: string, postId: string): Promise<SocialPost | null> {
        const { Item } = await this.ddb.getItem(Tables.SOCIAL_POSTS, { orgId, postId });
        return (Item as SocialPost) ?? null;
    }

    /** Idempotent create — postId is deterministic for launcher-generated posts. */
    async createPost(post: SocialPost): Promise<void> {
        const item: SocialPost = { ...post };
        if (post.status === 'queued') item.dueKey = SOCIAL_POST_DUE_KEY;
        else delete item.dueKey;
        await this.ddb.transactWrite([
            {
                Put: {
                    TableName: Tables.SOCIAL_POSTS,
                    Item: item,
                    ConditionExpression: 'attribute_not_exists(orgId)',
                },
            },
        ]);
    }

    async listByOrg(orgId: string, opts?: { limit?: number; exclusiveStartKey?: Record<string, any> }): Promise<{
        items: SocialPost[];
        lastEvaluatedKey?: Record<string, any>;
    }> {
        const { Items, LastEvaluatedKey } = await this.ddb.query({
            TableName: Tables.SOCIAL_POSTS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
            ScanIndexForward: false,
            Limit: opts?.limit ?? 20,
            ExclusiveStartKey: opts?.exclusiveStartKey,
        });
        return { items: (Items as SocialPost[]) ?? [], lastEvaluatedKey: LastEvaluatedKey };
    }

    /** Cron surface: queued posts due at or before `nowIso`, oldest first (sparse GSI). */
    async listDue(nowIso: string, limit = 25): Promise<SocialPost[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.SOCIAL_POSTS,
            IndexName: 'ByDue',
            KeyConditionExpression: 'dueKey = :d AND scheduledAt <= :now',
            ExpressionAttributeValues: { ':d': SOCIAL_POST_DUE_KEY, ':now': nowIso },
            Limit: limit,
        });
        return (Items as SocialPost[]) ?? [];
    }

    async updateDraft(orgId: string, postId: string, updates: { caption?: string; scheduledAt?: string; mediaKey?: string; mediaKeys?: string[]; platform?: 'facebook' | 'instagram' }): Promise<void> {
        const sets: string[] = ['updatedAt = :now'];
        const names: Record<string, string> = {};
        const values: Record<string, any> = { ':now': new Date().toISOString() };
        if (updates.caption !== undefined) { sets.push('caption = :c'); values[':c'] = updates.caption; }
        if (updates.scheduledAt !== undefined) { sets.push('scheduledAt = :s'); values[':s'] = updates.scheduledAt; }
        if (updates.mediaKey !== undefined) { sets.push('mediaKey = :m'); values[':m'] = updates.mediaKey; }
        if (updates.mediaKeys !== undefined) { sets.push('mediaKeys = :mk'); values[':mk'] = updates.mediaKeys; }
        // `platform` is a reserved-ish name in some contexts — alias it to be safe.
        if (updates.platform !== undefined) { sets.push('#pf = :pf'); names['#pf'] = 'platform'; values[':pf'] = updates.platform; }
        await this.ddb.update(Tables.SOCIAL_POSTS, { orgId, postId }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ConditionExpression: 'attribute_exists(orgId)',
            ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
            ExpressionAttributeValues: values,
        });
    }

    async queuePost(orgId: string, postId: string): Promise<void> {
        await this.ddb.update(Tables.SOCIAL_POSTS, { orgId, postId }, {
            UpdateExpression: 'SET #s = :queued, dueKey = :d, updatedAt = :now',
            ConditionExpression: '#s = :draft OR #s = :failed',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
                ':queued': 'queued', ':draft': 'draft', ':failed': 'failed',
                ':d': SOCIAL_POST_DUE_KEY, ':now': new Date().toISOString(),
            },
        });
    }

    /**
     * Exactly-once publish marker: wins only while still queued and never published.
     * Returns false if another invocation already claimed it.
     */
    async markPublished(orgId: string, postId: string, publishedExternalId: string): Promise<boolean> {
        try {
            await this.ddb.update(Tables.SOCIAL_POSTS, { orgId, postId }, {
                UpdateExpression: 'SET #s = :p, publishedExternalId = :xid, publishedAt = :now, updatedAt = :now REMOVE dueKey',
                ConditionExpression: '#s = :queued AND attribute_not_exists(publishedExternalId)',
                ExpressionAttributeNames: { '#s': 'status' },
                ExpressionAttributeValues: {
                    ':p': 'published', ':queued': 'queued',
                    ':xid': publishedExternalId, ':now': new Date().toISOString(),
                },
            });
            return true;
        } catch (err: any) {
            if (err?.name === 'ConditionalCheckFailedException') return false;
            throw err;
        }
    }

    /** Attempt bookkeeping; flips to failed (and off the due GSI) once maxAttempts is reached. */
    async recordAttemptFailure(orgId: string, postId: string, error: string, maxAttempts = 5): Promise<void> {
        const post = await this.getPost(orgId, postId);
        if (!post || post.status !== 'queued') return;
        const attempts = (post.attempts ?? 0) + 1;
        const failedOut = attempts >= maxAttempts;
        const params: Record<string, any> = {
            ConditionExpression: '#s = :queued',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
                ':queued': 'queued', ':a': attempts, ':e': error, ':now': new Date().toISOString(),
            },
        };
        if (failedOut) {
            params.UpdateExpression = 'SET attempts = :a, lastError = :e, #s = :f, updatedAt = :now REMOVE dueKey';
            params.ExpressionAttributeValues[':f'] = 'failed';
        } else {
            params.UpdateExpression = 'SET attempts = :a, lastError = :e, updatedAt = :now';
        }
        try {
            await this.ddb.update(Tables.SOCIAL_POSTS, { orgId, postId }, params);
        } catch (err: any) {
            if (err?.name !== 'ConditionalCheckFailedException') throw err;
        }
    }
}
