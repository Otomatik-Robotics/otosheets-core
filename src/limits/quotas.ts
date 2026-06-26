/**
 * Per-tier usage quotas — the single source of truth for chat token budgets
 * and workflow caps. Both the backend (gating + usage endpoints) and the agent
 * (pre-flight chat check + workflow-create guard) import these so the limits
 * never drift between the two enforcement points.
 *
 * Tier strings mirror `@otosheets/shared`'s `Tier` ('free' | 'starter' | 'pro')
 * but are kept as plain strings here to avoid a shared → core dependency.
 */
export type SubscriptionTier = 'free' | 'starter' | 'pro';

/** Monthly AI chat token budget per tier (-1 = unlimited). Linear scaling. */
export const CHAT_TOKEN_BUDGET: Record<SubscriptionTier, number> = {
    free: 100_000,
    starter: 1_000_000,
    pro: 5_000_000,
};

/** Maximum workflows an org may create per tier (-1 = unlimited). */
export const WORKFLOW_LIMIT: Record<SubscriptionTier, number> = {
    free: 3,
    starter: -1,
    pro: -1,
};

const asTier = (tier?: string | null): SubscriptionTier =>
    tier === 'starter' || tier === 'pro' ? tier : 'free';

/** Monthly chat token budget for a tier (defaults to free). -1 = unlimited. */
export function chatTokenBudget(tier?: string | null): number {
    return CHAT_TOKEN_BUDGET[asTier(tier)];
}

/** Workflow cap for a tier (defaults to free). -1 = unlimited. */
export function workflowLimit(tier?: string | null): number {
    return WORKFLOW_LIMIT[asTier(tier)];
}

/** True if a tier is a paying tier (gates seats + the paid-only features). */
export function isPaidTier(tier?: string | null): boolean {
    return asTier(tier) !== 'free';
}
