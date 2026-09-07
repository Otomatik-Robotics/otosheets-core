import { and, eq, sql } from 'drizzle-orm';
import { workflowRuns, workflowWakes } from '../pg/schema/workflows';
import type { PgDb } from '../pg/client';
import type { WorkflowRuntimeRun, WorkflowWake } from './repo';
export const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function workflowScope(orgId: string): string {
    if (!orgId || orgId.startsWith('__') || !/^[a-zA-Z0-9_-]+$/.test(orgId)) throw new Error('Invalid workflow organisation');
    return orgId;
}
export function workflowConflict(): never { const e = new Error('Workflow conditional write failed'); e.name = 'ConditionalCheckFailedException'; throw e; }
export const runWhere = (orgId: string, runId: string) => and(eq(workflowRuns.orgId, workflowScope(orgId)), eq(workflowRuns.runId, runId));
export async function lockedRun(db: PgDb, orgId: string, runId: string): Promise<WorkflowRuntimeRun | null> {
    const rows = await db.select().from(workflowRuns).where(runWhere(orgId, runId)).for('update');
    return rows[0]?.payload as WorkflowRuntimeRun ?? null;
}
export const runRow = (orgId: string, run: Record<string, any>) => ({ orgId: workflowScope(orgId), runId: String(run.runId), workflowId: String(run.workflowId), status: String(run.status), startedAt: String(run.startedAt ?? ''), payload: clean({ ...run, orgId, sk: `WFRUN#${run.runId}` }) });
export async function writeRun(db: PgDb, orgId: string, run: WorkflowRuntimeRun): Promise<void> { await db.update(workflowRuns).set(runRow(orgId, run)).where(runWhere(orgId, run.runId)); }
export const wakeRow = (wake: WorkflowWake) => {
    workflowScope(wake.orgId); const dueAt = new Date(wake.dueAt).toISOString();
    return { orgId: wake.orgId, wakeId: wake.wakeId, runId: wake.runId, workflowId: wake.workflowId, dueAt, payload: clean({ ...wake, dueAt, sk: `WFWAKE#${wake.wakeId}`, ttl: Math.floor(Date.parse(dueAt) / 1000) + 90 * 86400 }) };
};
export async function insertWake(db: PgDb, wake: WorkflowWake, replace = false): Promise<boolean> {
    const row = wakeRow(wake); const insert = db.insert(workflowWakes).values(row);
    const changed = replace ? await insert.onConflictDoUpdate({ target: [workflowWakes.orgId, workflowWakes.wakeId], set: row }).returning() : await insert.onConflictDoNothing().returning();
    return changed.length > 0;
}
export const pageLimit = (n?: number) => Math.max(1, Math.min(100, Number.isFinite(n) ? Math.floor(n!) : 20));
export function pageToken(token: string | undefined, scope: unknown[]): any[] | undefined {
    if (!token) return undefined;
    try { const decoded = JSON.parse(Buffer.from(token, 'base64').toString()); if (JSON.stringify(decoded.scope) !== JSON.stringify(scope) || !Array.isArray(decoded.key)) throw Error(); return decoded.key; } catch { throw new Error('Invalid nextToken'); }
}
export const nextPage = (scope: unknown[], key: unknown[]) => Buffer.from(JSON.stringify({ scope, key })).toString('base64');
