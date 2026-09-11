import { and, eq, or, lt, desc, sql } from 'drizzle-orm';
import { getPgTx, type PgDb } from '../pg/client';
import { workflowApprovals as approvals } from '../pg/schema/workflows';
import { clean, workflowScope, pageLimit, pageToken, nextPage } from '../workflowRuntime/pgHelpers';
import type { WorkflowApproval } from './schema';
import type { IWorkflowApprovalRepo } from './repo';
const where = (orgId: string, approvalId: string) => and(eq(approvals.orgId, workflowScope(orgId)), eq(approvals.approvalId, approvalId));
const row = (a: Omit<WorkflowApproval, 'sk'>) => ({ businessProfileId: a.businessProfileId ?? null, orgId: workflowScope(a.orgId), approvalId: a.approvalId, runId: a.runId, status: a.status, requestedAt: a.requestedAt, expiresAt: a.expiresAt ?? null, assignedTo: a.assignedTo, payload: clean({ ...a, sk: `APPROVAL#${a.approvalId}` }) });
export class WorkflowApprovalPgRepo implements IWorkflowApprovalRepo {
    constructor(private readonly injected?: PgDb) {}
    private get db() { return this.injected ?? getPgTx(); }
    async create(a: Omit<WorkflowApproval, 'sk'>): Promise<boolean> { return (await this.db.insert(approvals).values(row(a)).onConflictDoNothing().returning()).length > 0; }
    async get(orgId: string, approvalId: string): Promise<WorkflowApproval | null> { return (await this.db.select().from(approvals).where(where(orgId, approvalId)))[0]?.payload as WorkflowApproval ?? null; }
    async put(a: Omit<WorkflowApproval, 'sk'>): Promise<void> { const value = row(a); await this.db.insert(approvals).values(value).onConflictDoUpdate({ target: [approvals.orgId, approvals.approvalId], set: value }); }
    async decide(orgId: string, approvalId: string, membershipId: string, decidedBy: string, decision: 'approved' | 'rejected', now: string, comment?: string): Promise<boolean> {
        return this.db.transaction(async tx => { const a = (await tx.select().from(approvals).where(where(orgId, approvalId)).for('update'))[0]?.payload as WorkflowApproval | undefined;
            if (!a || a.status !== 'pending' || !a.assignedTo.includes(membershipId) || (a.expiresAt && a.expiresAt <= now)) return false;
            await tx.update(approvals).set(row({ ...a, status: decision, decision, decidedAt: now, decidedBy, comment: comment ?? '' })).where(where(orgId, approvalId)); return true;
        });
    }
    async expire(orgId: string, approvalId: string, now: string): Promise<boolean> {
        return this.db.transaction(async tx => { const a = (await tx.select().from(approvals).where(where(orgId, approvalId)).for('update'))[0]?.payload as WorkflowApproval | undefined;
            if (!a || a.status !== 'pending' || !a.expiresAt || a.expiresAt > now) return false; await tx.update(approvals).set(row({ ...a, status: 'expired', decidedAt: now })).where(where(orgId, approvalId)); return true;
        });
    }
    async listPendingPage(orgId: string, membershipId: string, nextToken?: string, requestedLimit = 20, businessProfileId?: string) {
        const scope = [workflowScope(orgId), 'approvals', membershipId, businessProfileId ?? null]; const key = pageToken(nextToken, scope); const limit = pageLimit(requestedLimit);
        const rows = await this.db.select().from(approvals).where(and(eq(approvals.orgId, orgId), businessProfileId ? eq(approvals.businessProfileId, businessProfileId) : undefined, eq(approvals.status, 'pending'), sql`${approvals.assignedTo} @> ${JSON.stringify([membershipId])}::jsonb`, sql`(${approvals.expiresAt} is null or ${approvals.expiresAt} > ${new Date().toISOString()})`, key ? or(lt(approvals.requestedAt, key[0]), and(eq(approvals.requestedAt, key[0]), lt(approvals.approvalId, key[1]))) : undefined)).orderBy(desc(approvals.requestedAt), desc(approvals.approvalId)).limit(limit + 1);
        const items = rows.slice(0, limit); const last = items.at(-1); return { approvals: items.map(r => r.payload as WorkflowApproval), ...(rows.length > limit && last ? { nextToken: nextPage(scope, [last.requestedAt, last.approvalId]) } : {}) };
    }
    async listPending(orgId: string, businessProfileId?: string): Promise<WorkflowApproval[]> { return (await this.db.select().from(approvals).where(and(eq(approvals.orgId, workflowScope(orgId)), businessProfileId ? eq(approvals.businessProfileId, businessProfileId) : undefined, eq(approvals.status, 'pending')))).map(r => r.payload as WorkflowApproval); }
    async resolve(orgId: string, approvalId: string, status: 'approved' | 'rejected', resolvedBy: string, comment?: string): Promise<void> {
        await this.db.transaction(async tx => { const a = (await tx.select().from(approvals).where(where(orgId, approvalId)).for('update'))[0]?.payload as WorkflowApproval | undefined; if (!a) throw new Error('Approval not found'); await tx.update(approvals).set(row({ ...a, status, resolvedAt: new Date().toISOString(), resolvedBy, ...(comment ? { comment } : {}) })).where(where(orgId, approvalId)); });
    }
}
