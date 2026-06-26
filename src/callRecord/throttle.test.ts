import { describe, it, expect } from 'vitest';
import { CallRecordRepo } from './repo';
import type { IDdb } from '../ddbPort';

/**
 * Minimal IDdb stub modelling the `ADD #count` atomic counter + UPDATED_NEW
 * return that bumpInboundThrottle relies on (the shared repo-test stub doesn't
 * cover ADD / ReturnValues).
 */
function makeCounterDdb() {
    const store = new Map<string, any>();
    const ddb = {
        async update(_t: string, key: any, params: any) {
            const k = `${key.orgId}|${key.sk}`;
            const item = store.get(k) ?? { orgId: key.orgId, sk: key.sk };
            // ADD #count :one
            const addMatch = params.UpdateExpression.match(/ADD\s+(#\w+)\s+(:\w+)/);
            if (addMatch) {
                const attr = params.ExpressionAttributeNames[addMatch[1]];
                item[attr] = (item[attr] ?? 0) + params.ExpressionAttributeValues[addMatch[2]];
            }
            // SET ttl/createdAt via if_not_exists — only set when absent
            for (const m of params.UpdateExpression.matchAll(/(#?\w+)\s*=\s*if_not_exists\([^,]+,\s*(:\w+)\)/g)) {
                const rawName = m[1];
                const attr = params.ExpressionAttributeNames?.[rawName] ?? rawName;
                if (item[attr] === undefined) item[attr] = params.ExpressionAttributeValues[m[2]];
            }
            store.set(k, item);
            return { Attributes: { ...item } };
        },
    };
    return { ddb: ddb as unknown as IDdb, store };
}

describe('CallRecordRepo.bumpInboundThrottle', () => {
    it('increments within the same window bucket', async () => {
        const { ddb } = makeCounterDdb();
        const repo = new CallRecordRepo(ddb);
        const now = 1_000_000_000_000;
        expect(await repo.bumpInboundThrottle('org1', '+61400000000', now, 600)).toBe(1);
        expect(await repo.bumpInboundThrottle('org1', '+61400000000', now + 1000, 600)).toBe(2);
        expect(await repo.bumpInboundThrottle('org1', '+61400000000', now + 2000, 600)).toBe(3);
    });

    it('resets in a new window bucket', async () => {
        const { ddb } = makeCounterDdb();
        const repo = new CallRecordRepo(ddb);
        const now = 1_000_000_000_000;
        await repo.bumpInboundThrottle('org1', '+61400000000', now, 600);
        await repo.bumpInboundThrottle('org1', '+61400000000', now, 600);
        // +11 minutes → next 10-minute bucket → fresh counter
        const next = await repo.bumpInboundThrottle('org1', '+61400000000', now + 11 * 60_000, 600);
        expect(next).toBe(1);
    });

    it('counts per caller independently', async () => {
        const { ddb } = makeCounterDdb();
        const repo = new CallRecordRepo(ddb);
        const now = 1_000_000_000_000;
        await repo.bumpInboundThrottle('org1', '+61400000001', now, 600);
        expect(await repo.bumpInboundThrottle('org1', '+61400000002', now, 600)).toBe(1);
    });

    it('sets a ttl so buckets auto-expire', async () => {
        const { ddb, store } = makeCounterDdb();
        const repo = new CallRecordRepo(ddb);
        const now = 1_000_000_000_000;
        await repo.bumpInboundThrottle('org1', '+61400000000', now, 600);
        const item = [...store.values()][0];
        expect(item.ttl).toBeGreaterThan(Math.floor(now / 1000));
    });
});
