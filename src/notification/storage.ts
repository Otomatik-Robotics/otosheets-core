/** Single-store cutover only. Pause writers and reconcile before leaving maintenance. */
export type NotificationStorageMode = 'dynamo' | 'pg' | 'maintenance';
let cached: { key: string; value: NotificationStorageMode; until: number } | undefined;
export function resetNotificationStorageCache(): void { cached = undefined; }
export async function notificationStorageMode(): Promise<'dynamo' | 'pg'> {
    const override = process.env.DATA_BACKEND_NOTIFICATIONS;
    const prefix = process.env.DATA_BACKEND_SSM_PREFIX;
    let mode: string = override ?? 'dynamo';
    if (override === undefined && prefix) {
        const key = `${prefix}/notifications`;
        if (cached?.key === key && cached.until > Date.now()) mode = cached.value;
        else {
            const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
            try { mode = (await new SSMClient({}).send(new GetParameterCommand({ Name: key }))).Parameter?.Value ?? ''; }
            catch (error) {
                if ((error as { name?: string }).name !== 'ParameterNotFound') throw error;
                mode = 'dynamo';
            }
            if (!['dynamo', 'pg', 'maintenance'].includes(mode)) throw new Error('Invalid notification storage mode');
            cached = { key, value: mode as NotificationStorageMode, until: Date.now() + 5000 };
        }
    }
    if (mode === 'maintenance') throw new Error('Notification storage migration is in progress. Retry shortly.');
    if (mode !== 'dynamo' && mode !== 'pg') throw new Error('Invalid notification storage mode');
    return mode;
}
