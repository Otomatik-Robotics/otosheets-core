"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnboardingWorkflowStoredSchema = void 0;
const zod_1 = require("zod");
const WorkflowNodePositionSchema = zod_1.z.object({
    x: zod_1.z.number(),
    y: zod_1.z.number(),
});
const EventFilterSchema = zod_1.z.object({
    field: zod_1.z.string(),
    operator: zod_1.z.enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'in']),
    value: zod_1.z.union([zod_1.z.string(), zod_1.z.number(), zod_1.z.array(zod_1.z.string())]),
});
const WorkflowNodeDataSchema = zod_1.z.object({
    label: zod_1.z.string(),
    nodeType: zod_1.z.enum([
        'TRIGGER',
        'CONDITION',
        'TOOL_CALL',
        'APPROVAL',
        'AGENT',
    ]),
    /** Plain-English instructions describing what this step does and why */
    instructions: zod_1.z.string().optional(),
    // TRIGGER fields
    eventType: zod_1.z.string().optional(),
    eventFilters: zod_1.z.array(EventFilterSchema).optional(),
    roleFilters: zod_1.z.array(zod_1.z.string()).optional(),
    teamFilters: zod_1.z.array(zod_1.z.string()).optional(),
    // CONDITION fields
    conditionField: zod_1.z.string().optional(),
    conditionSource: zod_1.z.enum(['context', 'payload', 'variable']).optional(),
    conditionOperator: zod_1.z.enum([
        'eq', 'neq', 'gt', 'lt', 'gte', 'lte',
        'contains', 'in',
        'starts_with', 'ends_with',
        'is_empty', 'is_not_empty',
        'regex_match', 'between',
    ]).optional(),
    conditionValue: zod_1.z.string().optional(),
    // TOOL_CALL fields — references an agent tool by name
    toolName: zod_1.z.string().optional(),
    toolParams: zod_1.z.record(zod_1.z.unknown()).optional(),
    toolOutputKey: zod_1.z.string().optional(),
    toolDomain: zod_1.z.enum(['billing', 'operations', 'growth', 'team']).optional(),
    // APPROVAL fields
    approverIds: zod_1.z.array(zod_1.z.string()).optional(),
    approvalMode: zod_1.z.enum(['any', 'all']).optional(),
    approvalTimeoutDays: zod_1.z.number().optional(),
    // AGENT fields — LLM-powered reasoning step
    agentToolDomains: zod_1.z.array(zod_1.z.enum(['billing', 'operations', 'growth', 'team'])).optional(),
    agentOutputKey: zod_1.z.string().optional(),
    agentMaxTurns: zod_1.z.number().optional(),
    // Variable capture (available on any node)
    outputVariables: zod_1.z.array(zod_1.z.object({
        name: zod_1.z.string(),
        key: zod_1.z.string(),
    })).optional(),
});
const WorkflowNodeSchema = zod_1.z.object({
    id: zod_1.z.string(),
    type: zod_1.z.string(),
    position: WorkflowNodePositionSchema,
    data: WorkflowNodeDataSchema,
});
const WorkflowEdgeSchema = zod_1.z.object({
    id: zod_1.z.string(),
    source: zod_1.z.string(),
    target: zod_1.z.string(),
    sourceHandle: zod_1.z.string().optional(),
    targetHandle: zod_1.z.string().optional(),
    label: zod_1.z.string().optional(),
});
exports.OnboardingWorkflowStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    sk: zod_1.z.string(),
    workflowId: zod_1.z.string(),
    name: zod_1.z.string(),
    description: zod_1.z.string().optional(),
    isActive: zod_1.z.boolean().default(false),
    nodes: zod_1.z.array(WorkflowNodeSchema),
    edges: zod_1.z.array(WorkflowEdgeSchema),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
    createdBy: zod_1.z.string().optional(),
    updatedBy: zod_1.z.string().optional(),
    currentVersion: zod_1.z.number().optional(),
    activeVersion: zod_1.z.number().optional(),
    executorType: zod_1.z.enum(['v1_durable', 'v2_agent']).optional(),
});
//# sourceMappingURL=schema.js.map