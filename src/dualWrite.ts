/**
 * Dual-write helpers — docs/POSTGRES_MIGRATION_PLAN.md §6.1.
 *
 * `mirrorWrite` runs after a successful primary write and MUST NEVER fail the
 * request: failures are logged (structured, alarmable) and enqueued to the
 * repair queue if MIRROR_REPAIR_QUEUE_URL is set. Mirrors are full-entity
 * upserts from a fresh primary read (the caller passes that as `mirror`), so
 * they are idempotent and last-writer-wins by construction.
 *
 * `shadowRead` compares a sampled fraction of primary reads against the
 * shadow store and diff-logs; it also never affects the request.
 */

export interface RepairMessage {
    domain: string;
    entity: string;
    op: string;
    /** Enough to re-copy the entity from primary → mirror. */
    key: Record<string, string>;
}

let sqsClient: any;

async function enqueueRepair(msg: RepairMessage): Promise<void> {
    const queueUrl = process.env.MIRROR_REPAIR_QUEUE_URL;
    if (!queueUrl) return; // pre-queue environments: the log line is the signal
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
    if (!sqsClient) sqsClient = new SQSClient({});
    await sqsClient.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(msg),
    }));
}

export async function mirrorWrite(
    context: RepairMessage,
    mirror: () => Promise<void>,
): Promise<void> {
    try {
        await mirror();
    } catch (err: any) {
        // Metric filter target — keep the prefix stable (§10 alarms).
        console.error('[mirror-write-failure]', JSON.stringify({
            ...context,
            error: err?.message ?? String(err),
        }));
        try {
            await enqueueRepair(context);
        } catch (repairErr: any) {
            console.error('[mirror-repair-enqueue-failure]', JSON.stringify({
                ...context,
                error: repairErr?.message ?? String(repairErr),
            }));
        }
    }
}

/** Normalize DTOs for comparison: null and undefined are equivalent, key order ignored. */
export function normalizeForDiff(value: any): any {
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value)) return value.map(normalizeForDiff);
    if (typeof value === 'object') {
        const out: Record<string, any> = {};
        for (const key of Object.keys(value).sort()) {
            const v = normalizeForDiff(value[key]);
            if (v !== undefined) out[key] = v;
        }
        return out;
    }
    return value;
}

function sampleRate(domain: string): number {
    const raw = process.env[`SHADOW_SAMPLE_${domain.toUpperCase().replace(/-/g, '_')}`];
    const n = raw ? Number(raw) : NaN;
    if (!Number.isNaN(n) && n >= 0 && n <= 1) return n;
    return 0.1;
}

export async function shadowRead<T>(
    context: { domain: string; entity: string; op: string },
    primaryResult: T,
    shadow: () => Promise<T>,
    random: () => number = Math.random,
): Promise<void> {
    if (random() >= sampleRate(context.domain)) return;
    try {
        const shadowResult = await shadow();
        const a = JSON.stringify(normalizeForDiff(primaryResult));
        const b = JSON.stringify(normalizeForDiff(shadowResult));
        if (a !== b) {
            // Metric filter target — keep the prefix stable (§10 alarms).
            console.error('[shadow-read-diff]', JSON.stringify({ ...context, primary: a, shadow: b }));
        }
    } catch (err: any) {
        console.error('[shadow-read-error]', JSON.stringify({
            ...context,
            error: err?.message ?? String(err),
        }));
    }
}
