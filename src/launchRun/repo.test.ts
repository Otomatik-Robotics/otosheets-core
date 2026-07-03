import { describe, it, expect, beforeEach } from 'vitest';
import { LaunchRunRepo } from './repo';
import { LaunchRun } from './schema';
import type { IDdb } from '../ddbPort';

process.env.LAUNCH_RUNS_TABLE = 'launch-runs-test';

// Stub simulating the two conditional writes the repo relies on: the ACTIVE-pointer
// create guard, and the steps.#sid.status transition condition.
function makeStubDdb() {
    const store = new Map<string, any>();
    const keyOf = (k: any) => `${k.orgId}|${k.runId}`;
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
            const names = params.ExpressionAttributeNames ?? {};
            const values = params.ExpressionAttributeValues ?? {};
            const fail = () => {
                const err: any = new Error('conditional failed');
                err.name = 'ConditionalCheckFailedException';
                throw err;
            };
            if (!item) fail();
            // Step transition condition: steps.#sid.#st IN (:from0, :from1, ...)
            if (params.ConditionExpression?.includes('steps.#sid.#st')) {
                const current = item.steps[names['#sid']]?.status;
                const allowed = Object.entries(values)
                    .filter(([k]) => k.startsWith(':from'))
                    .map(([, v]) => v);
                if (!allowed.includes(current)) fail();
                const step = item.steps[names['#sid']];
                step.status = values[':to'];
                if (values[':art']) step.artifacts = values[':art'];
                if (values[':err']) step.error = values[':err'];
                return {};
            }
            // Asset upsert: SET assets.#aid = if_not_exists(assets.#aid, :a)
            if (params.UpdateExpression?.includes('assets.#aid = if_not_exists')) {
                const aid = names['#aid'];
                if (!(aid in item.assets)) item.assets[aid] = values[':a'];
                return {};
            }
            if (values[':s'] !== undefined) item.status = values[':s'];
            if (values[':p'] !== undefined) item.profile = values[':p'];
            return {};
        },
        async delete(_t: string, key: any) {
            store.delete(keyOf(key));
            return {};
        },
    };
    return { ddb: ddb as unknown as IDdb, store };
}

const baseRun = (over: Partial<LaunchRun> = {}): LaunchRun => ({
    orgId: 'org1', runId: 'run1', status: 'running',
    profile: { businessName: 'Joes Mowing', businessNameCandidates: [], services: [], serviceAreas: [], targetCustomers: [], usps: [] },
    steps: {
        abn_verify: { status: 'pending' },
        profile_saved: { status: 'pending', dependsOn: ['abn_verify'] },
    },
    assets: {},
    createdAt: 't0', updatedAt: 't0', ...over,
});

describe('LaunchRunRepo', () => {
    let repo: LaunchRunRepo;
    let store: Map<string, any>;

    beforeEach(() => {
        const stub = makeStubDdb();
        repo = new LaunchRunRepo(stub.ddb);
        store = stub.store;
    });

    it('createRun enforces a single active run per org', async () => {
        await repo.createRun(baseRun());
        await expect(repo.createRun(baseRun({ runId: 'run2' }))).rejects.toThrow();
    });

    it('getActiveRun resolves through the ACTIVE pointer', async () => {
        await repo.createRun(baseRun());
        const run = await repo.getActiveRun('org1');
        expect(run?.runId).toBe('run1');
    });

    it('terminal setRunStatus releases the pointer so a new run can start', async () => {
        await repo.createRun(baseRun());
        await repo.setRunStatus('org1', 'run1', 'completed');
        expect(await repo.getActiveRun('org1')).toBeNull();
        await expect(repo.createRun(baseRun({ runId: 'run2' }))).resolves.toBeUndefined();
    });

    it('transitionStep wins only from an expected state', async () => {
        await repo.createRun(baseRun());

        const won = await repo.transitionStep('org1', 'run1', 'abn_verify', 'running', ['pending', 'failed']);
        expect(won).toBe(true);

        // Second racer attempting the same pending→running transition loses.
        const lost = await repo.transitionStep('org1', 'run1', 'abn_verify', 'running', ['pending', 'failed']);
        expect(lost).toBe(false);

        const done = await repo.transitionStep('org1', 'run1', 'abn_verify', 'done', ['running'], {
            artifacts: { abn: '12345678901' },
        });
        expect(done).toBe(true);
        expect(store.get('org1|run1').steps.abn_verify.artifacts.abn).toBe('12345678901');
    });

    it('putAsset is idempotent per assetId', async () => {
        await repo.createRun(baseRun());
        const asset = { assetId: 'a1', kind: 'work_photo' as const, createdAt: 't1' };

        await repo.putAsset('org1', 'run1', asset);
        await repo.putAsset('org1', 'run1', { ...asset, alt: 'second write must not clobber' });

        expect(store.get('org1|run1').assets.a1.alt).toBeUndefined();
    });
});
