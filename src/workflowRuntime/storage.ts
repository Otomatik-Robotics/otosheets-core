/** Workflow claims cannot be dual-written. Cut over only while writes and consumers are paused. */
export type WorkflowStorageMode = 'dynamo' | 'pg' | 'maintenance';
let cached: { key: string; value: WorkflowStorageMode; until: number } | undefined;
export function resetWorkflowStorageCache(): void { cached = undefined; }
export async function workflowStorageMode(): Promise<'dynamo' | 'pg'> {
    const override = process.env.DATA_BACKEND_WORKFLOWS;
    const prefix = process.env.DATA_BACKEND_SSM_PREFIX;
    let mode: string = override || 'dynamo';
    if (!override && prefix) {
        const key = `${prefix}/workflows`;
        if (cached?.key === key && cached.until > Date.now()) mode = cached.value;
        else {
            const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
            try { mode = (await new SSMClient({}).send(new GetParameterCommand({ Name: key }))).Parameter?.Value ?? ''; }
            catch (error: any) { if (error?.name !== 'ParameterNotFound') throw error; mode = 'dynamo'; }
            if (!['dynamo', 'pg', 'maintenance'].includes(mode)) throw new Error('Invalid workflow storage mode');
            cached = { key, value: mode as WorkflowStorageMode, until: Date.now() + 5000 };
        }
    }
    if (mode === 'maintenance') throw new Error('Workflow storage migration is in progress. Retry shortly.');
    if (mode !== 'pg' && mode !== 'dynamo') throw new Error('Invalid workflow storage mode');
    return mode;
}
