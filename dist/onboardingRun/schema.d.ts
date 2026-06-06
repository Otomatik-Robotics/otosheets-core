import { z } from 'zod';
declare const CompletedNodeSchema: z.ZodObject<{
    nodeId: z.ZodString;
    completedAt: z.ZodString;
    result: z.ZodOptional<z.ZodAny>;
}, "strip", z.ZodTypeAny, {
    completedAt: string;
    nodeId: string;
    result?: any;
}, {
    completedAt: string;
    nodeId: string;
    result?: any;
}>;
export declare const WorkflowRunStoredSchema: z.ZodObject<{
    orgId: z.ZodString;
    sk: z.ZodString;
    runId: z.ZodOptional<z.ZodString>;
    membershipId: z.ZodOptional<z.ZodString>;
    workflowId: z.ZodString;
    workflowName: z.ZodOptional<z.ZodString>;
    eventType: z.ZodOptional<z.ZodString>;
    triggeredBy: z.ZodOptional<z.ZodString>;
    executorType: z.ZodOptional<z.ZodEnum<["v1_durable", "v2_agent"]>>;
    status: z.ZodDefault<z.ZodEnum<["IN_PROGRESS", "COMPLETED", "FAILED", "PAUSED"]>>;
    completedNodes: z.ZodDefault<z.ZodArray<z.ZodObject<{
        nodeId: z.ZodString;
        completedAt: z.ZodString;
        result: z.ZodOptional<z.ZodAny>;
    }, "strip", z.ZodTypeAny, {
        completedAt: string;
        nodeId: string;
        result?: any;
    }, {
        completedAt: string;
        nodeId: string;
        result?: any;
    }>, "many">>;
    nodeResults: z.ZodOptional<z.ZodArray<z.ZodObject<{
        nodeId: z.ZodString;
        nodeLabel: z.ZodOptional<z.ZodString>;
        nodeType: z.ZodOptional<z.ZodString>;
        success: z.ZodBoolean;
        message: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        nodeId: string;
        success: boolean;
        message?: string | undefined;
        nodeType?: string | undefined;
        nodeLabel?: string | undefined;
        durationMs?: number | undefined;
    }, {
        nodeId: string;
        success: boolean;
        message?: string | undefined;
        nodeType?: string | undefined;
        nodeLabel?: string | undefined;
        durationMs?: number | undefined;
    }>, "many">>;
    checkpoint: z.ZodOptional<z.ZodObject<{
        pausedAtNodeId: z.ZodString;
        pausedReason: z.ZodLiteral<"APPROVAL">;
        approvalId: z.ZodString;
        payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        visitedNodes: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        payload: Record<string, unknown>;
        pausedAtNodeId: string;
        pausedReason: "APPROVAL";
        approvalId: string;
        visitedNodes: string[];
    }, {
        payload: Record<string, unknown>;
        pausedAtNodeId: string;
        pausedReason: "APPROVAL";
        approvalId: string;
        visitedNodes: string[];
    }>>;
    context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    startedAt: z.ZodString;
    completedAt: z.ZodOptional<z.ZodString>;
    durationMs: z.ZodOptional<z.ZodNumber>;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "IN_PROGRESS" | "COMPLETED" | "FAILED" | "PAUSED";
    orgId: string;
    sk: string;
    startedAt: string;
    workflowId: string;
    completedNodes: {
        completedAt: string;
        nodeId: string;
        result?: any;
    }[];
    membershipId?: string | undefined;
    completedAt?: string | undefined;
    eventType?: string | undefined;
    context?: Record<string, any> | undefined;
    executorType?: "v1_durable" | "v2_agent" | undefined;
    runId?: string | undefined;
    workflowName?: string | undefined;
    triggeredBy?: string | undefined;
    durationMs?: number | undefined;
    nodeResults?: {
        nodeId: string;
        success: boolean;
        message?: string | undefined;
        nodeType?: string | undefined;
        nodeLabel?: string | undefined;
        durationMs?: number | undefined;
    }[] | undefined;
    checkpoint?: {
        payload: Record<string, unknown>;
        pausedAtNodeId: string;
        pausedReason: "APPROVAL";
        approvalId: string;
        visitedNodes: string[];
    } | undefined;
    error?: string | undefined;
}, {
    orgId: string;
    sk: string;
    startedAt: string;
    workflowId: string;
    status?: "IN_PROGRESS" | "COMPLETED" | "FAILED" | "PAUSED" | undefined;
    membershipId?: string | undefined;
    completedAt?: string | undefined;
    eventType?: string | undefined;
    context?: Record<string, any> | undefined;
    executorType?: "v1_durable" | "v2_agent" | undefined;
    runId?: string | undefined;
    workflowName?: string | undefined;
    triggeredBy?: string | undefined;
    completedNodes?: {
        completedAt: string;
        nodeId: string;
        result?: any;
    }[] | undefined;
    durationMs?: number | undefined;
    nodeResults?: {
        nodeId: string;
        success: boolean;
        message?: string | undefined;
        nodeType?: string | undefined;
        nodeLabel?: string | undefined;
        durationMs?: number | undefined;
    }[] | undefined;
    checkpoint?: {
        payload: Record<string, unknown>;
        pausedAtNodeId: string;
        pausedReason: "APPROVAL";
        approvalId: string;
        visitedNodes: string[];
    } | undefined;
    error?: string | undefined;
}>;
export type WorkflowRun = z.infer<typeof WorkflowRunStoredSchema>;
export type CompletedNode = z.infer<typeof CompletedNodeSchema>;
/** @deprecated Use WorkflowRunStoredSchema */
export declare const OnboardingRunStoredSchema: z.ZodObject<{
    orgId: z.ZodString;
    sk: z.ZodString;
    runId: z.ZodOptional<z.ZodString>;
    membershipId: z.ZodOptional<z.ZodString>;
    workflowId: z.ZodString;
    workflowName: z.ZodOptional<z.ZodString>;
    eventType: z.ZodOptional<z.ZodString>;
    triggeredBy: z.ZodOptional<z.ZodString>;
    executorType: z.ZodOptional<z.ZodEnum<["v1_durable", "v2_agent"]>>;
    status: z.ZodDefault<z.ZodEnum<["IN_PROGRESS", "COMPLETED", "FAILED", "PAUSED"]>>;
    completedNodes: z.ZodDefault<z.ZodArray<z.ZodObject<{
        nodeId: z.ZodString;
        completedAt: z.ZodString;
        result: z.ZodOptional<z.ZodAny>;
    }, "strip", z.ZodTypeAny, {
        completedAt: string;
        nodeId: string;
        result?: any;
    }, {
        completedAt: string;
        nodeId: string;
        result?: any;
    }>, "many">>;
    nodeResults: z.ZodOptional<z.ZodArray<z.ZodObject<{
        nodeId: z.ZodString;
        nodeLabel: z.ZodOptional<z.ZodString>;
        nodeType: z.ZodOptional<z.ZodString>;
        success: z.ZodBoolean;
        message: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        nodeId: string;
        success: boolean;
        message?: string | undefined;
        nodeType?: string | undefined;
        nodeLabel?: string | undefined;
        durationMs?: number | undefined;
    }, {
        nodeId: string;
        success: boolean;
        message?: string | undefined;
        nodeType?: string | undefined;
        nodeLabel?: string | undefined;
        durationMs?: number | undefined;
    }>, "many">>;
    checkpoint: z.ZodOptional<z.ZodObject<{
        pausedAtNodeId: z.ZodString;
        pausedReason: z.ZodLiteral<"APPROVAL">;
        approvalId: z.ZodString;
        payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        visitedNodes: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        payload: Record<string, unknown>;
        pausedAtNodeId: string;
        pausedReason: "APPROVAL";
        approvalId: string;
        visitedNodes: string[];
    }, {
        payload: Record<string, unknown>;
        pausedAtNodeId: string;
        pausedReason: "APPROVAL";
        approvalId: string;
        visitedNodes: string[];
    }>>;
    context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    startedAt: z.ZodString;
    completedAt: z.ZodOptional<z.ZodString>;
    durationMs: z.ZodOptional<z.ZodNumber>;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "IN_PROGRESS" | "COMPLETED" | "FAILED" | "PAUSED";
    orgId: string;
    sk: string;
    startedAt: string;
    workflowId: string;
    completedNodes: {
        completedAt: string;
        nodeId: string;
        result?: any;
    }[];
    membershipId?: string | undefined;
    completedAt?: string | undefined;
    eventType?: string | undefined;
    context?: Record<string, any> | undefined;
    executorType?: "v1_durable" | "v2_agent" | undefined;
    runId?: string | undefined;
    workflowName?: string | undefined;
    triggeredBy?: string | undefined;
    durationMs?: number | undefined;
    nodeResults?: {
        nodeId: string;
        success: boolean;
        message?: string | undefined;
        nodeType?: string | undefined;
        nodeLabel?: string | undefined;
        durationMs?: number | undefined;
    }[] | undefined;
    checkpoint?: {
        payload: Record<string, unknown>;
        pausedAtNodeId: string;
        pausedReason: "APPROVAL";
        approvalId: string;
        visitedNodes: string[];
    } | undefined;
    error?: string | undefined;
}, {
    orgId: string;
    sk: string;
    startedAt: string;
    workflowId: string;
    status?: "IN_PROGRESS" | "COMPLETED" | "FAILED" | "PAUSED" | undefined;
    membershipId?: string | undefined;
    completedAt?: string | undefined;
    eventType?: string | undefined;
    context?: Record<string, any> | undefined;
    executorType?: "v1_durable" | "v2_agent" | undefined;
    runId?: string | undefined;
    workflowName?: string | undefined;
    triggeredBy?: string | undefined;
    completedNodes?: {
        completedAt: string;
        nodeId: string;
        result?: any;
    }[] | undefined;
    durationMs?: number | undefined;
    nodeResults?: {
        nodeId: string;
        success: boolean;
        message?: string | undefined;
        nodeType?: string | undefined;
        nodeLabel?: string | undefined;
        durationMs?: number | undefined;
    }[] | undefined;
    checkpoint?: {
        payload: Record<string, unknown>;
        pausedAtNodeId: string;
        pausedReason: "APPROVAL";
        approvalId: string;
        visitedNodes: string[];
    } | undefined;
    error?: string | undefined;
}>;
/** @deprecated Use WorkflowRun */
export type OnboardingRun = WorkflowRun;
export declare const WorkflowApprovalStoredSchema: z.ZodObject<{
    orgId: z.ZodString;
    sk: z.ZodString;
    approvalId: z.ZodString;
    runId: z.ZodString;
    workflowId: z.ZodString;
    workflowName: z.ZodString;
    nodeId: z.ZodString;
    status: z.ZodDefault<z.ZodEnum<["pending", "approved", "rejected"]>>;
    requestedAt: z.ZodString;
    requestedBy: z.ZodString;
    resolvedAt: z.ZodOptional<z.ZodString>;
    resolvedBy: z.ZodOptional<z.ZodString>;
    assignedTo: z.ZodArray<z.ZodString, "many">;
    approverType: z.ZodOptional<z.ZodString>;
    message: z.ZodOptional<z.ZodString>;
    comment: z.ZodOptional<z.ZodString>;
    expiryDays: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    status: "pending" | "approved" | "rejected";
    orgId: string;
    sk: string;
    assignedTo: string[];
    workflowId: string;
    nodeId: string;
    runId: string;
    workflowName: string;
    approvalId: string;
    requestedAt: string;
    requestedBy: string;
    message?: string | undefined;
    resolvedAt?: string | undefined;
    resolvedBy?: string | undefined;
    approverType?: string | undefined;
    comment?: string | undefined;
    expiryDays?: number | undefined;
}, {
    orgId: string;
    sk: string;
    assignedTo: string[];
    workflowId: string;
    nodeId: string;
    runId: string;
    workflowName: string;
    approvalId: string;
    requestedAt: string;
    requestedBy: string;
    status?: "pending" | "approved" | "rejected" | undefined;
    message?: string | undefined;
    resolvedAt?: string | undefined;
    resolvedBy?: string | undefined;
    approverType?: string | undefined;
    comment?: string | undefined;
    expiryDays?: number | undefined;
}>;
export type WorkflowApproval = z.infer<typeof WorkflowApprovalStoredSchema>;
export {};
//# sourceMappingURL=schema.d.ts.map