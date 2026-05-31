import { z } from 'zod';

const CompletedNodeSchema = z.object({
    nodeId: z.string(),
    completedAt: z.string(),
    result: z.any().optional(),
});

export const WorkflowRunStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(),
    runId: z.string().optional(),
    membershipId: z.string().optional(),
    workflowId: z.string(),
    workflowName: z.string().optional(),
    eventType: z.string().optional(),
    triggeredBy: z.string().optional(),
    executorType: z.enum(['v1_durable', 'v2_agent']).optional(),
    status: z.enum(['IN_PROGRESS', 'COMPLETED', 'FAILED', 'PAUSED']).default('IN_PROGRESS'),
    completedNodes: z.array(CompletedNodeSchema).default([]),
    nodeResults: z.array(z.object({
        nodeId: z.string(),
        nodeLabel: z.string().optional(),
        nodeType: z.string().optional(),
        success: z.boolean(),
        message: z.string().optional(),
        durationMs: z.number().optional(),
    })).optional(),
    checkpoint: z.object({
        pausedAtNodeId: z.string(),
        pausedReason: z.literal('APPROVAL'),
        approvalId: z.string(),
        payload: z.record(z.unknown()),
        visitedNodes: z.array(z.string()),
    }).optional(),
    context: z.record(z.any()).optional(),
    startedAt: z.string(),
    completedAt: z.string().optional(),
    durationMs: z.number().optional(),
    error: z.string().optional(),
});

export type WorkflowRun = z.infer<typeof WorkflowRunStoredSchema>;
export type CompletedNode = z.infer<typeof CompletedNodeSchema>;

// Backward-compat aliases (deprecated — use WorkflowRun / WorkflowRunStoredSchema)
/** @deprecated Use WorkflowRunStoredSchema */
export const OnboardingRunStoredSchema = WorkflowRunStoredSchema;
/** @deprecated Use WorkflowRun */
export type OnboardingRun = WorkflowRun;

export const WorkflowApprovalStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(),
    approvalId: z.string(),
    runId: z.string(),
    workflowId: z.string(),
    workflowName: z.string(),
    nodeId: z.string(),
    status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
    requestedAt: z.string(),
    requestedBy: z.string(),
    resolvedAt: z.string().optional(),
    resolvedBy: z.string().optional(),
    assignedTo: z.array(z.string()),
    approverType: z.string().optional(),
    message: z.string().optional(),
    comment: z.string().optional(),
    expiryDays: z.number().optional(),
});
export type WorkflowApproval = z.infer<typeof WorkflowApprovalStoredSchema>;
