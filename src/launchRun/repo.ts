import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import {
    LAUNCH_RUN_ACTIVE_POINTER,
    LaunchAsset,
    LaunchProfile,
    LaunchRun,
    LaunchRunActivePointer,
    LaunchStepId,
    LaunchStepStatus,
} from './schema';

export class LaunchRunRepo {
    constructor(private ddb: IDdb) {}

    async getRun(orgId: string, runId: string): Promise<LaunchRun | null> {
        const { Item } = await this.ddb.getItem(Tables.LAUNCH_RUNS, { orgId, runId });
        return (Item as LaunchRun) ?? null;
    }

    async getActiveRun(orgId: string): Promise<LaunchRun | null> {
        const { Item } = await this.ddb.getItem(Tables.LAUNCH_RUNS, {
            orgId,
            runId: LAUNCH_RUN_ACTIVE_POINTER,
        });
        const pointer = Item as LaunchRunActivePointer | undefined;
        if (!pointer?.activeRunId) return null;
        return this.getRun(orgId, pointer.activeRunId);
    }

    /** Creates the run + ACTIVE pointer atomically; fails if a run is already active. */
    async createRun(run: LaunchRun): Promise<void> {
        const pointer: LaunchRunActivePointer = {
            orgId: run.orgId,
            runId: LAUNCH_RUN_ACTIVE_POINTER,
            activeRunId: run.runId,
            createdAt: run.createdAt,
        };
        await this.ddb.transactWrite([
            {
                Put: {
                    TableName: Tables.LAUNCH_RUNS,
                    Item: pointer,
                    ConditionExpression: 'attribute_not_exists(orgId)',
                },
            },
            {
                Put: {
                    TableName: Tables.LAUNCH_RUNS,
                    Item: run,
                    ConditionExpression: 'attribute_not_exists(orgId)',
                },
            },
        ]);
    }

    /** Releases the ACTIVE pointer when a run reaches a terminal state. */
    async setRunStatus(orgId: string, runId: string, status: LaunchRun['status']): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.update(Tables.LAUNCH_RUNS, { orgId, runId }, {
            UpdateExpression: 'SET #s = :s, updatedAt = :now',
            ConditionExpression: 'attribute_exists(orgId)',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':s': status, ':now': now },
        });
        if (['completed', 'partially_completed', 'abandoned'].includes(status)) {
            await this.ddb.delete(Tables.LAUNCH_RUNS, { orgId, runId: LAUNCH_RUN_ACTIVE_POINTER });
        }
    }

    async saveProfile(orgId: string, runId: string, profile: LaunchProfile, transcript?: string): Promise<void> {
        const params: Record<string, any> = {
            UpdateExpression: 'SET profile = :p, updatedAt = :now',
            ConditionExpression: 'attribute_exists(orgId)',
            ExpressionAttributeValues: { ':p': profile, ':now': new Date().toISOString() },
        };
        if (transcript !== undefined) {
            params.UpdateExpression += ', transcript = :t';
            params.ExpressionAttributeValues[':t'] = transcript;
        }
        await this.ddb.update(Tables.LAUNCH_RUNS, { orgId, runId }, params);
    }

    /**
     * Conditional step transition — the write wins only if the step is currently in one of
     * `expectedFrom`, making concurrent advance/retry calls safe.
     * Returns false when the condition failed (someone else already transitioned it).
     */
    async transitionStep(
        orgId: string,
        runId: string,
        stepId: LaunchStepId,
        toStatus: LaunchStepStatus,
        expectedFrom: LaunchStepStatus[],
        extras?: { error?: string; artifacts?: Record<string, string> },
    ): Promise<boolean> {
        const now = new Date().toISOString();
        let update = 'SET steps.#sid.#st = :to, updatedAt = :now';
        const names: Record<string, string> = { '#sid': stepId, '#st': 'status' };
        const values: Record<string, any> = { ':to': toStatus, ':now': now };

        if (toStatus === 'running') update += ', steps.#sid.startedAt = if_not_exists(steps.#sid.startedAt, :now)';
        if (toStatus === 'done' || toStatus === 'skipped') update += ', steps.#sid.completedAt = :now';
        if (extras?.error) { update += ', steps.#sid.#err = :err'; names['#err'] = 'error'; values[':err'] = extras.error; }
        if (extras?.artifacts) { update += ', steps.#sid.artifacts = :art'; values[':art'] = extras.artifacts; }

        const condition = expectedFrom.map((_, i) => `steps.#sid.#st = :from${i}`).join(' OR ');
        expectedFrom.forEach((s, i) => { values[`:from${i}`] = s; });

        try {
            await this.ddb.update(Tables.LAUNCH_RUNS, { orgId, runId }, {
                UpdateExpression: update,
                ConditionExpression: `attribute_exists(orgId) AND (${condition})`,
                ExpressionAttributeNames: names,
                ExpressionAttributeValues: values,
            });
            return true;
        } catch (err: any) {
            if (err?.name === 'ConditionalCheckFailedException') return false;
            throw err;
        }
    }

    /** Idempotent asset upsert — assetId is deterministic (derived from the S3 key). */
    async putAsset(orgId: string, runId: string, asset: LaunchAsset): Promise<void> {
        await this.ddb.update(Tables.LAUNCH_RUNS, { orgId, runId }, {
            UpdateExpression: 'SET assets.#aid = if_not_exists(assets.#aid, :a), updatedAt = :now',
            ConditionExpression: 'attribute_exists(orgId)',
            ExpressionAttributeNames: { '#aid': asset.assetId },
            ExpressionAttributeValues: { ':a': asset, ':now': new Date().toISOString() },
        });
    }

    /** Owner (re)assigns a photo to a site slot from the confirm screen. */
    async setAssetSlot(orgId: string, runId: string, assetId: string, chosenFor: LaunchAsset['chosenFor']): Promise<void> {
        await this.ddb.update(Tables.LAUNCH_RUNS, { orgId, runId }, {
            UpdateExpression: 'SET assets.#aid.chosenFor = :c, updatedAt = :now',
            ConditionExpression: 'attribute_exists(assets.#aid)',
            ExpressionAttributeNames: { '#aid': assetId },
            ExpressionAttributeValues: { ':c': chosenFor, ':now': new Date().toISOString() },
        });
    }
}
