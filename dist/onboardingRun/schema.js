"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowApprovalStoredSchema = exports.OnboardingRunStoredSchema = exports.WorkflowRunStoredSchema = void 0;
const zod_1 = require("zod");
const CompletedNodeSchema = zod_1.z.object({
    nodeId: zod_1.z.string(),
    completedAt: zod_1.z.string(),
    result: zod_1.z.any().optional(),
});
exports.WorkflowRunStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    sk: zod_1.z.string(),
    runId: zod_1.z.string().optional(),
    membershipId: zod_1.z.string().optional(),
    workflowId: zod_1.z.string(),
    workflowName: zod_1.z.string().optional(),
    eventType: zod_1.z.string().optional(),
    triggeredBy: zod_1.z.string().optional(),
    executorType: zod_1.z.enum(['v1_durable', 'v2_agent']).optional(),
    status: zod_1.z.enum(['IN_PROGRESS', 'COMPLETED', 'FAILED', 'PAUSED']).default('IN_PROGRESS'),
    completedNodes: zod_1.z.array(CompletedNodeSchema).default([]),
    nodeResults: zod_1.z.array(zod_1.z.object({
        nodeId: zod_1.z.string(),
        nodeLabel: zod_1.z.string().optional(),
        nodeType: zod_1.z.string().optional(),
        success: zod_1.z.boolean(),
        message: zod_1.z.string().optional(),
        durationMs: zod_1.z.number().optional(),
    })).optional(),
    checkpoint: zod_1.z.object({
        pausedAtNodeId: zod_1.z.string(),
        pausedReason: zod_1.z.literal('APPROVAL'),
        approvalId: zod_1.z.string(),
        payload: zod_1.z.record(zod_1.z.unknown()),
        visitedNodes: zod_1.z.array(zod_1.z.string()),
    }).optional(),
    context: zod_1.z.record(zod_1.z.any()).optional(),
    startedAt: zod_1.z.string(),
    completedAt: zod_1.z.string().optional(),
    durationMs: zod_1.z.number().optional(),
    error: zod_1.z.string().optional(),
});
// Backward-compat aliases (deprecated — use WorkflowRun / WorkflowRunStoredSchema)
/** @deprecated Use WorkflowRunStoredSchema */
exports.OnboardingRunStoredSchema = exports.WorkflowRunStoredSchema;
exports.WorkflowApprovalStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    sk: zod_1.z.string(),
    approvalId: zod_1.z.string(),
    runId: zod_1.z.string(),
    workflowId: zod_1.z.string(),
    workflowName: zod_1.z.string(),
    nodeId: zod_1.z.string(),
    status: zod_1.z.enum(['pending', 'approved', 'rejected']).default('pending'),
    requestedAt: zod_1.z.string(),
    requestedBy: zod_1.z.string(),
    resolvedAt: zod_1.z.string().optional(),
    resolvedBy: zod_1.z.string().optional(),
    assignedTo: zod_1.z.array(zod_1.z.string()),
    approverType: zod_1.z.string().optional(),
    message: zod_1.z.string().optional(),
    comment: zod_1.z.string().optional(),
    expiryDays: zod_1.z.number().optional(),
});
//# sourceMappingURL=schema.js.map