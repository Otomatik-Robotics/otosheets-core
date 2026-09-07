import { pgTable, text, integer, boolean, jsonb, primaryKey, index } from 'drizzle-orm/pg-core';

const payload = () => jsonb('payload').$type<Record<string, any>>().notNull();
export const workflowDefinitions = pgTable('workflow_definitions', {
    businessProfileId: text('business_profile_id'),
    orgId: text('org_id').notNull(), workflowId: text('workflow_id').notNull(),
    name: text('name').notNull(), isActive: boolean('is_active').notNull(), updatedAt: text('updated_at').notNull(), payload: payload(),
}, t => [primaryKey({ columns: [t.orgId, t.workflowId] }), index('workflow_definitions_org_updated_idx').on(t.orgId, t.updatedAt, t.workflowId)]);
export const workflowVersions = pgTable('workflow_versions', {
    businessProfileId: text('business_profile_id'),
    orgId: text('org_id').notNull(), workflowId: text('workflow_id').notNull(), version: integer('version').notNull(), payload: payload(),
}, t => [primaryKey({ columns: [t.orgId, t.workflowId, t.version] })]);
export const workflowRuns = pgTable('workflow_runs', {
    businessProfileId: text('business_profile_id'),
    orgId: text('org_id').notNull(), runId: text('run_id').notNull(), workflowId: text('workflow_id').notNull(),
    status: text('status').notNull(), startedAt: text('started_at').notNull(), payload: payload(),
}, t => [primaryKey({ columns: [t.orgId, t.runId] }), index('workflow_runs_org_started_idx').on(t.orgId, t.startedAt, t.runId), index('workflow_runs_workflow_started_idx').on(t.orgId, t.workflowId, t.startedAt, t.runId), index('workflow_runs_status_started_idx').on(t.orgId, t.status, t.startedAt, t.runId)]);
export const workflowSteps = pgTable('workflow_steps', {
    orgId: text('org_id').notNull(), runId: text('run_id').notNull(), nodeId: text('node_id').notNull(), payload: payload(),
}, t => [primaryKey({ columns: [t.orgId, t.runId, t.nodeId] })]);
export const workflowWakes = pgTable('workflow_wakes', {
    orgId: text('org_id').notNull(), wakeId: text('wake_id').notNull(), runId: text('run_id').notNull(), workflowId: text('workflow_id').notNull(), dueAt: text('due_at').notNull(), payload: payload(),
}, t => [primaryKey({ columns: [t.orgId, t.wakeId] }), index('workflow_wakes_due_idx').on(t.dueAt, t.orgId, t.wakeId)]);
export const workflowApprovals = pgTable('workflow_approvals', {
    businessProfileId: text('business_profile_id'),
    orgId: text('org_id').notNull(), approvalId: text('approval_id').notNull(), runId: text('run_id').notNull(), status: text('status').notNull(),
    requestedAt: text('requested_at').notNull(), expiresAt: text('expires_at'), assignedTo: jsonb('assigned_to').$type<string[]>().notNull(), payload: payload(),
}, t => [primaryKey({ columns: [t.orgId, t.approvalId] }), index('workflow_approvals_pending_idx').on(t.orgId, t.status, t.requestedAt, t.approvalId)]);
export const workflowAudit = pgTable('workflow_audit', {
    orgId: text('org_id').notNull(), recordId: text('record_id').notNull(), runId: text('run_id').notNull(), kind: text('kind').notNull(), payload: payload(),
}, t => [primaryKey({ columns: [t.orgId, t.recordId] }), index('workflow_audit_run_idx').on(t.orgId, t.runId, t.kind, t.recordId)]);
