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
        'SEND_EMAIL', 'SEND_SMS', 'GENERATE_DOCUMENT', 'FILL_TEMPLATE',
        'CREATE_CALENDAR_EVENT', 'SCHEDULE_CALL', 'DELAY', 'SYSTEM',
    ]),

    /** Plain-English instructions describing what this step does and why */
    instructions: z.string().optional(),

    // TRIGGER fields
    eventType: z.string().optional(),
    schedule: z.object({
        frequency: z.enum(['once', 'weekly', 'monthly']),
        timeZone: z.string(), time: z.string(), date: z.string().optional(),
        daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
        dayOfMonth: z.union([z.number().int().min(1).max(31), z.literal('last')]).optional(),
    }).optional(),
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

    emailTo: z.string().optional(),
    emailSubject: z.string().optional(),
    emailBody: z.string().optional(),
    emailAttachments: z.array(z.object({ documentId: z.string(), filename: z.string().optional() })).max(5).optional(),
    smsTo: z.string().optional(),
    smsBody: z.string().optional(),
    fillTemplateId: z.string().optional(),
    fillVariables: z.record(z.string()).optional(),
    fillFilename: z.string().optional(),
    calendarTitle: z.string().optional(),
    calendarStart: z.string().optional(),
    calendarEnd: z.string().optional(),
    calendarTimezone: z.string().optional(),
    calendarDescription: z.string().optional(),
    calendarLocation: z.string().optional(),
    documentTemplateId: z.string().optional(),
    documentTitle: z.string().optional(),
    documentRoles: z.array(z.object({ roleKey: z.string(), name: z.string().optional(), email: z.string().optional() })).optional(),
    documentSend: z.boolean().optional(),
    callLeadField: z.string().optional(),
    callDirective: z.string().optional(),
    callFirstMessage: z.string().optional(),
    callKnownCustomer: z.boolean().optional(),
    callVerifyIdentity: z.boolean().optional(),
    callAllowVoicemail: z.boolean().optional(),
    callBrief: z.boolean().optional(),
    delayDays: z.number().int().min(0).optional(),
    delayHours: z.number().int().min(0).max(23).optional(),
    delayMinutes: z.number().int().min(0).max(59).optional(),
    delayUntil: z.string().optional(),
    delayTimezone: z.string().optional(),

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
