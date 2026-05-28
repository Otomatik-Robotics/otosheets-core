import { z } from 'zod';

const WorkflowNodePositionSchema = z.object({
    x: z.number(),
    y: z.number(),
});

const EventFilterSchema = z.object({
    field: z.string(),
    operator: z.enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'in']),
    value: z.union([z.string(), z.number(), z.array(z.string())]),
});

const WorkflowNodeDataSchema = z.object({
    label: z.string(),
    nodeType: z.enum([
        'TRIGGER',
        'CONDITION',
        'TOOL_CALL',
        'APPROVAL',
        'AGENT',
    ]),

    /** Plain-English instructions describing what this step does and why */
    instructions: z.string().optional(),

    // TRIGGER fields
    eventType: z.string().optional(),
    eventFilters: z.array(EventFilterSchema).optional(),
    roleFilters: z.array(z.string()).optional(),
    teamFilters: z.array(z.string()).optional(),

    // CONDITION fields
    conditionField: z.string().optional(),
    conditionSource: z.enum(['context', 'payload', 'variable']).optional(),
    conditionOperator: z.enum([
        'eq', 'neq', 'gt', 'lt', 'gte', 'lte',
        'contains', 'in',
        'starts_with', 'ends_with',
        'is_empty', 'is_not_empty',
        'regex_match', 'between',
    ]).optional(),
    conditionValue: z.string().optional(),

    // TOOL_CALL fields — references an agent tool by name
    toolName: z.string().optional(),
    toolParams: z.record(z.unknown()).optional(),
    toolOutputKey: z.string().optional(),
    toolDomain: z.enum(['billing', 'operations', 'growth', 'team']).optional(),

    // APPROVAL fields
    approverIds: z.array(z.string()).optional(),
    approvalMode: z.enum(['any', 'all']).optional(),
    approvalTimeoutDays: z.number().optional(),

    // AGENT fields — LLM-powered reasoning step
    agentToolDomains: z.array(z.enum(['billing', 'operations', 'growth', 'team'])).optional(),
    agentOutputKey: z.string().optional(),
    agentMaxTurns: z.number().optional(),

    // Variable capture (available on any node)
    outputVariables: z.array(z.object({
        name: z.string(),
        key: z.string(),
    })).optional(),
});

const WorkflowNodeSchema = z.object({
    id: z.string(),
    type: z.string(),
    position: WorkflowNodePositionSchema,
    data: WorkflowNodeDataSchema,
});

const WorkflowEdgeSchema = z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    sourceHandle: z.string().optional(),
    targetHandle: z.string().optional(),
    label: z.string().optional(),
});

export const OnboardingWorkflowStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(),
    workflowId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    isActive: z.boolean().default(false),
    nodes: z.array(WorkflowNodeSchema),
    edges: z.array(WorkflowEdgeSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
    createdBy: z.string().optional(),
    updatedBy: z.string().optional(),
    currentVersion: z.number().optional(),
    activeVersion: z.number().optional(),
    executorType: z.enum(['v1_durable', 'v2_agent']).optional(),
});
export type OnboardingWorkflow = z.infer<typeof OnboardingWorkflowStoredSchema>;
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;
export type WorkflowNodeData = z.infer<typeof WorkflowNodeDataSchema>;
