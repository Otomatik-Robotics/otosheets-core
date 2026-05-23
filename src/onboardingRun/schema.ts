import { z } from 'zod';

const CompletedNodeSchema = z.object({
    nodeId: z.string(),
    completedAt: z.string(),
    result: z.any().optional(),
});

export const OnboardingRunStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(),
    runId: z.string().optional(),
    membershipId: z.string().optional(),
    workflowId: z.string(),
    eventType: z.string().optional(),
    status: z.enum(['IN_PROGRESS', 'COMPLETED', 'FAILED']).default('IN_PROGRESS'),
    completedNodes: z.array(CompletedNodeSchema).default([]),
    context: z.record(z.any()).optional(),
    startedAt: z.string(),
    completedAt: z.string().optional(),
    error: z.string().optional(),
});
export type OnboardingRun = z.infer<typeof OnboardingRunStoredSchema>;
export type WorkflowRun = OnboardingRun;
export type CompletedNode = z.infer<typeof CompletedNodeSchema>;
