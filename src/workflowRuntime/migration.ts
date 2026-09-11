import { and, eq } from 'drizzle-orm';
import type { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { getPgTx, type PgDb } from '../pg/client';
import { workflowDefinitions, workflowVersions, workflowRuns, workflowSteps, workflowWakes, workflowApprovals, workflowAudit } from '../pg/schema/workflows';
import { clean, workflowScope } from './pgHelpers';

export const WORKFLOW_RECORD_PREFIXES = ['WORKFLOW#', 'VERSION#', 'WFRUN#', 'WFSTEP#', 'WFWAKE#', 'WFREVIEW#', 'WFINPUT#', 'APPROVAL#', 'EXECLOG#'];
/** Admin migration boundary. Caller must pause workflow writes and queue consumers before copying. */
export class WorkflowMigrationRepo {
    constructor(private readonly source: IDdb, private readonly injected?: PgDb) {}
    private get db() { return this.injected ?? getPgTx(); }
    async sourcePage(nextToken?: string, limit = 100) {
        const result = await this.source.scan({ TableName: Tables.ONBOARDING, ConsistentRead: true,
            FilterExpression: WORKFLOW_RECORD_PREFIXES.map((_, i) => `begins_with(sk, :p${i})`).join(' OR '),
            ExpressionAttributeValues: Object.fromEntries(WORKFLOW_RECORD_PREFIXES.map((p, i) => [`:p${i}`, p])),
            ExclusiveStartKey: nextToken ? JSON.parse(Buffer.from(nextToken, 'base64').toString()) : undefined, Limit: Math.max(1, Math.min(500, limit)),
        });
        return { items: result.Items ?? [], ...(result.LastEvaluatedKey ? { nextToken: Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64') } : {}) };
    }
    private mapping(record: Record<string, any>) {
        const orgId = workflowScope(record.orgId); const sk = String(record.sk); const payload = clean(record);
        if (sk.startsWith('WORKFLOW#')) return { table: workflowDefinitions, key: and(eq(workflowDefinitions.orgId, orgId), eq(workflowDefinitions.workflowId, record.workflowId)), row: { orgId, workflowId: record.workflowId, name: record.name, isActive: !!record.isActive, updatedAt: record.updatedAt ?? '', payload } };
        if (sk.startsWith('VERSION#')) return { table: workflowVersions, key: and(eq(workflowVersions.orgId, orgId), eq(workflowVersions.workflowId, record.workflowId), eq(workflowVersions.version, record.version)), row: { orgId, workflowId: record.workflowId, version: record.version, payload } };
        if (sk.startsWith('WFRUN#')) return { table: workflowRuns, key: and(eq(workflowRuns.orgId, orgId), eq(workflowRuns.runId, record.runId)), row: { orgId, runId: record.runId, workflowId: record.workflowId, status: record.status, startedAt: record.startedAt ?? '', payload } };
        if (sk.startsWith('WFSTEP#')) return { table: workflowSteps, key: and(eq(workflowSteps.orgId, orgId), eq(workflowSteps.runId, record.runId), eq(workflowSteps.nodeId, record.nodeId)), row: { orgId, runId: record.runId, nodeId: record.nodeId, payload } };
        if (sk.startsWith('WFWAKE#')) return { table: workflowWakes, key: and(eq(workflowWakes.orgId, orgId), eq(workflowWakes.wakeId, record.wakeId)), row: { orgId, wakeId: record.wakeId, runId: record.runId, workflowId: record.workflowId, dueAt: new Date(record.dueAt).toISOString(), payload } };
        if (sk.startsWith('APPROVAL#')) return { table: workflowApprovals, key: and(eq(workflowApprovals.orgId, orgId), eq(workflowApprovals.approvalId, record.approvalId)), row: { orgId, approvalId: record.approvalId, runId: record.runId, status: record.status, requestedAt: record.requestedAt ?? '', expiresAt: record.expiresAt ?? null, assignedTo: record.assignedTo ?? [], payload } };
        if (['WFREVIEW#', 'WFINPUT#', 'EXECLOG#'].some(prefix => sk.startsWith(prefix))) return { table: workflowAudit, key: and(eq(workflowAudit.orgId, orgId), eq(workflowAudit.recordId, sk)), row: { orgId, recordId: sk, runId: record.runId, kind: sk.startsWith('WFREVIEW#') ? 'review' : sk.startsWith('WFINPUT#') ? 'input' : 'execution', payload } };
        throw new Error('Record is outside workflow migration scope');
    }
    async importRecord(record: Record<string, any>): Promise<void> {
        const mapped = this.mapping(record);
        await this.db.transaction(async tx => {
            // The migration is paused; updates make retries after a partial copy safe.
            const existing = await tx.select().from(mapped.table).where(mapped.key);
            if (existing.length) await tx.update(mapped.table).set(mapped.row as any).where(mapped.key);
            else await tx.insert(mapped.table).values(mapped.row as any);
        });
    }
    async importedRecord(source: Record<string, any>): Promise<Record<string, any> | null> {
        const mapped = this.mapping(source); return (await this.db.select().from(mapped.table).where(mapped.key))[0]?.payload ?? null;
    }
}
