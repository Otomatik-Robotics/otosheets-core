import { z } from 'zod';

const WorkflowNodePositionSchema = z.object({
    x: z.number(),
    y: z.number(),
});

const WorkflowNodeDataSchema = z.object({
    label: z.string(),
    nodeType: z.enum([
        'TRIGGER',
        'CONDITION',
        'SEND_WELCOME_EMAIL',
        'ASSIGN_COMPLIANCE',
        'ASSIGN_GENERAL_TASK',
        'SEND_INVITE_LINK',
        'ADD_TO_TEAM',
        'WAIT',
        'NOTIFY_ADMIN',
    ]),
    roleFilters: z.array(z.string()).optional(),
    teamFilters: z.array(z.string()).optional(),
    templateTaskIds: z.array(z.string()).optional(),
    welcomeEmailTemplateId: z.string().optional(),
    teamId: z.string().optional(),
    waitDays: z.number().optional(),
    taskTitle: z.string().optional(),
    taskDescription: z.string().optional(),
    inviteLinks: z.array(z.object({
        name: z.string(),
        url: z.string(),
    })).optional(),
    conditionField: z.enum(['role', 'team']).optional(),
    conditionValue: z.string().optional(),
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
