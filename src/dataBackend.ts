/**
 * Cutover state-machine flag reader — docs/POSTGRES_MIGRATION_PLAN.md §6.
 *
 * Resolution order per domain:
 *   1. env var `DATA_BACKEND_{DOMAIN}` (upper snake, e.g. DATA_BACKEND_IDENTITY)
 *      — override for tests, local dev, and emergency pinning; bypasses SSM
 *   2. SSM parameter `{DATA_BACKEND_SSM_PREFIX}/{domain}`, cached 60s
 *   3. default `dynamo` (ship-dark safe: missing parameter ⇒ status quo)
 *
 * The 60s cache TTL bounds the mixed-fleet window during flips (§6.2). Reads
 * are synchronous-fast after the first call per TTL window.
 */
export type DataBackendState = 'dynamo' | 'dual_dynamo' | 'dual_pg' | 'pg';
export type DataDomain = 'identity' | 'billing-core' | 'leads' | 'ops';

const VALID_STATES: ReadonlySet<string> = new Set(['dynamo', 'dual_dynamo', 'dual_pg', 'pg']);
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
    state: DataBackendState;
    expiresAt: number;
}

const cache = new Map<DataDomain, CacheEntry>();
let ssmClient: any;

function envOverride(domain: DataDomain): DataBackendState | undefined {
    const raw = process.env[`DATA_BACKEND_${domain.toUpperCase().replace(/-/g, '_')}`];
    if (raw && VALID_STATES.has(raw)) return raw as DataBackendState;
    return undefined;
}

async function readFromSsm(domain: DataDomain): Promise<DataBackendState> {
    const prefix = process.env.DATA_BACKEND_SSM_PREFIX;
    if (!prefix) return 'dynamo';
    try {
        if (!ssmClient) {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { SSMClient } = require('@aws-sdk/client-ssm');
            ssmClient = new SSMClient({});
        }
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { GetParameterCommand } = require('@aws-sdk/client-ssm');
        const out = await ssmClient.send(new GetParameterCommand({ Name: `${prefix}/${domain}` }));
        const value = out.Parameter?.Value;
        if (value && VALID_STATES.has(value)) return value as DataBackendState;
        if (value) console.error(`[dataBackend] invalid state '${value}' for domain '${domain}' — falling back to dynamo`);
        return 'dynamo';
    } catch (err: any) {
        if (err?.name !== 'ParameterNotFound') {
            console.error(`[dataBackend] SSM read failed for '${domain}' — falling back to dynamo:`, err?.message ?? err);
        }
        return 'dynamo';
    }
}

export async function dataBackend(domain: DataDomain): Promise<DataBackendState> {
    const override = envOverride(domain);
    if (override) return override;

    const hit = cache.get(domain);
    if (hit && hit.expiresAt > Date.now()) return hit.state;

    const state = await readFromSsm(domain);
    cache.set(domain, { state, expiresAt: Date.now() + CACHE_TTL_MS });
    return state;
}

/** Test seam — drop cached states (and the memoized SSM client). */
export function resetDataBackendCache(): void {
    cache.clear();
    ssmClient = undefined;
}

/** How a routing repo should behave for the domain's current state (§6.1). */
export interface Route {
    primary: 'dynamo' | 'pg';
    mirror?: 'dynamo' | 'pg';
    /** Sampled shadow reads against pg while Dynamo is authoritative. */
    shadow: boolean;
}

export async function resolveRoute(domain: DataDomain): Promise<Route> {
    switch (await dataBackend(domain)) {
        case 'dynamo':      return { primary: 'dynamo', shadow: false };
        case 'dual_dynamo': return { primary: 'dynamo', mirror: 'pg', shadow: true };
        case 'dual_pg':     return { primary: 'pg', mirror: 'dynamo', shadow: false };
        case 'pg':          return { primary: 'pg', shadow: false };
    }
}
