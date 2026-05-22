import { z } from 'zod';

const CompletedNodeSchema = z.object({
    nodeId: z.string(),
    completedAt: z.string(),
    result: z.any().optional(),
});

export const OnboardingRunStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(),
    membershipId: z.string(),
    workflowId: z.string(),
    status: z.enum(['IN_PROGRESS', 'COMPLETED', 'FAILED']).default('IN_PROGRESS'),
    completedNodes: z.array(CompletedNodeSchema).default([]),
    context: z.record(z.any()).optional(),
    startedAt: z.string(),
    completedAt: z.string().optional(),
    error: z.string().optional(),
});
export type OnboardingRun = z.infer<typeof OnboardingRunStoredSchema>;
export type CompletedNode = z.infer<typeof CompletedNodeSchema>;
