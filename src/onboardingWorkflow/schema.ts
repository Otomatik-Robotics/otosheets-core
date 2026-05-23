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
        'SEND_WELCOME_EMAIL',
        'SEND_EMAIL',
        'SEND_SMS',
        'ASSIGN_COMPLIANCE',
        'ASSIGN_GENERAL_TASK',
        'CREATE_TASK',
        'SEND_INVITE_LINK',
        'ADD_TO_TEAM',
        'ONBOARD_TO_SYSTEM',
        'WAIT',
        'NOTIFY_ADMIN',
    ]),

    // TRIGGER fields
    eventType: z.string().optional(),
    eventFilters: z.array(EventFilterSchema).optional(),
    roleFilters: z.array(z.string()).optional(),
    teamFilters: z.array(z.string()).optional(),

    // CONDITION fields
    conditionField: z.string().optional(),
    conditionSource: z.enum(['context', 'payload']).optional(),
    conditionOperator: z.enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'in']).optional(),
    conditionValue: z.string().optional(),

    // SEND_WELCOME_EMAIL (legacy)
    welcomeEmailTemplateId: z.string().optional(),

    // SEND_EMAIL fields
    emailTemplateId: z.string().optional(),
    recipientType: z.enum(['trigger_user', 'org_admins', 'custom']).optional(),
    customRecipientEmail: z.string().optional(),

    // SEND_SMS fields
    smsBody: z.string().optional(),
    smsRecipientType: z.enum(['trigger_user', 'org_admins', 'custom']).optional(),
    customRecipientPhone: z.string().optional(),

    // Team / system fields
    teamId: z.string().optional(),
    systemId: z.string().optional(),
    systemCapabilityIds: z.array(z.string()).optional(),

    // WAIT
    waitDays: z.number().optional(),

    // SEND_INVITE_LINK
    inviteLinks: z.array(z.object({
        name: z.string(),
        url: z.string(),
    })).optional(),

    // Task fields (ASSIGN_COMPLIANCE, ASSIGN_GENERAL_TASK, CREATE_TASK)
    taskType: z.enum(['DOCUMENT_UPLOAD', 'FORM_FILL', 'ACKNOWLEDGEMENT', 'GENERAL_TASK']).optional(),
    taskTitle: z.string().optional(),
    taskDescription: z.string().optional(),
    taskCategory: z.string().optional(),
    taskRequired: z.boolean().optional(),
    dueDaysAfterInvite: z.number().optional(),
    acceptedFileTypes: z.array(z.string()).optional(),
    formFields: z.array(z.object({
        name: z.string(),
        label: z.string(),
        type: z.string(),
        required: z.boolean(),
    })).optional(),
    acknowledgementText: z.string().optional(),
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
});
export type OnboardingWorkflow = z.infer<typeof OnboardingWorkflowStoredSchema>;
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;
export type WorkflowNodeData = z.infer<typeof WorkflowNodeDataSchema>;
