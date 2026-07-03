import { describe, it, expect, beforeEach } from 'vitest';
import { SocialPostRepo } from './repo';
import { SOCIAL_POST_DUE_KEY, SocialPost } from './schema';
import type { IDdb } from '../ddbPort';

process.env.SOCIAL_POSTS_TABLE = 'social-posts-test';

// Stub simulating the exactly-once publish condition (queued + never published).
function makeStubDdb() {
    const store = new Map<string, any>();
    const keyOf = (k: any) => `${k.orgId}|${k.postId}`;
    const ddb = {
        async getItem(_t: string, key: any) {
            return { Item: store.get(keyOf(key)) };
        },
        async transactWrite(items: any[]) {
            for (const { Put } of items) {
                if (Put.ConditionExpression?.includes('attribute_not_exists') && store.has(keyOf(Put.Item))) {
                    const err: any = new Error('conditional failed');
                    err.name = 'TransactionCanceledException';
                    throw err;
                }
            }
            for (const { Put } of items) store.set(keyOf(Put.Item), { ...Put.Item });
            return {};
        },
        async update(_t: string, key: any, params: any) {
            const item = store.get(keyOf(key));
            const values = params.ExpressionAttributeValues ?? {};
            const fail = () => {
                const err: any = new Error('conditional failed');
                err.name = 'ConditionalCheckFailedException';
                throw err;
            };
            if (!item) fail();
            const cond = params.ConditionExpression ?? '';
            if (cond.includes(':queued') && item.status !== 'queued') fail();
            if (cond.includes('attribute_not_exists(publishedExternalId)') && item.publishedExternalId) fail();
            if (cond === '#s = :draft OR #s = :failed' && !['draft', 'failed'].includes(item.status)) fail();

            if (values[':p'] === 'published') {
                item.status = 'published';
                item.publishedExternalId = values[':xid'];
                delete item.dueKey;
            }
            if (values[':queued'] === 'queued' && params.UpdateExpression.includes('dueKey = :d')) {
                item.status = 'queued';
                item.dueKey = values[':d'];
            }
            if (values[':a'] !== undefined) {
                item.attempts = values[':a'];
                item.lastError = values[':e'];
                if (values[':f']) { item.status = values[':f']; delete item.dueKey; }
            }
            return {};
        },
        async query() { return { Items: [] }; },
    };
    return { ddb: ddb as unknown as IDdb, store };
}

const basePost = (over: Partial<SocialPost> = {}): SocialPost => ({
    orgId: 'org1', postId: 'p1', platform: 'facebook', caption: 'We are open!',
    scheduledAt: '2026-07-04T00:00:00.000Z', status: 'queued', attempts: 0,
    createdAt: 't0', updatedAt: 't0', ...over,
});

describe('SocialPostRepo', () => {
    let repo: SocialPostRepo;
    let store: Map<string, any>;

    beforeEach(() => {
        const stub = makeStubDdb();
        repo = new SocialPostRepo(stub.ddb);
        store = stub.store;
    });

    it('createPost sets the due key only for queued posts and rejects duplicates', async () => {
        await repo.createPost(basePost());
        expect(store.get('org1|p1').dueKey).toBe(SOCIAL_POST_DUE_KEY);

        await repo.createPost(basePost({ postId: 'p2', status: 'draft' }));
        expect(store.get('org1|p2').dueKey).toBeUndefined();

        await expect(repo.createPost(basePost())).rejects.toThrow();
    });

    it('markPublished wins exactly once', async () => {
        await repo.createPost(basePost());

        expect(await repo.markPublished('org1', 'p1', 'fb_123')).toBe(true);
        expect(await repo.markPublished('org1', 'p1', 'fb_456')).toBe(false);

        const item = store.get('org1|p1');
        expect(item.publishedExternalId).toBe('fb_123');
        expect(item.dueKey).toBeUndefined();
    });

    it('recordAttemptFailure fails the post out after maxAttempts and removes it from the due index', async () => {
        await repo.createPost(basePost());

        await repo.recordAttemptFailure('org1', 'p1', 'boom', 2);
        expect(store.get('org1|p1').status).toBe('queued');

        await repo.recordAttemptFailure('org1', 'p1', 'boom again', 2);
        const item = store.get('org1|p1');
        expect(item.status).toBe('failed');
        expect(item.dueKey).toBeUndefined();
        expect(item.attempts).toBe(2);
    });

    it('recordAttemptFailure is a no-op once the post is no longer queued', async () => {
        await repo.createPost(basePost({ status: 'draft' }));
        await repo.recordAttemptFailure('org1', 'p1', 'boom');
        expect(store.get('org1|p1').status).toBe('draft');
        expect(store.get('org1|p1').attempts).toBe(0);
    });
});
