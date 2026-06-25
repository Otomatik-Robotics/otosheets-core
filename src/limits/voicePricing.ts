/**
 * Voice-calling pricing — the single source of truth for what the platform
 * charges an org for the voice product. Both the backend (enqueue gate,
 * per-minute billing, top-up Checkout) and any future caller import these so the
 * numbers never drift between enforcement points.
 *
 * Everything is in AUD cents. The headline knobs (per-minute rate, the
 * minimum-minutes start gate, how many numbers are included free) are
 * env-overridable so they can be tuned without a code change; the rest are
 * plain constants. Mirrors the shape of `quotas.ts`.
 */

/** Parse a positive integer env var, falling back to a default. */
function intEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

/** Per-minute retail rate charged to the account (AUD cents). Default $1.00/min. */
export const VOICE_PER_MINUTE_CENTS = intEnv('VOICE_PER_MINUTE_CENTS', 100);

/** A call may only start if the balance covers at least this many minutes. */
export const VOICE_MIN_CALL_MINUTES = intEnv('VOICE_MIN_CALL_MINUTES', 3);

/** Numbers included in a paid subscription before per-number charges apply. */
export const FREE_NUMBERS_INCLUDED = intEnv('VOICE_FREE_NUMBERS_INCLUDED', 1);

/** Monthly charge per extra number (AUD cents) — for display; Stripe is the source of truth. */
export const EXTRA_NUMBER_MONTHLY_CENTS = intEnv('VOICE_EXTRA_NUMBER_MONTHLY_CENTS', 400);

/** Prepaid top-up packs offered in the UI (AUD cents). */
export const TOPUP_PACKS_CENTS: number[] = [1000, 2500, 5000, 10000];

/** Bounds for a custom top-up amount (AUD cents). */
export const TOPUP_CUSTOM_MIN_CENTS = intEnv('VOICE_TOPUP_MIN_CENTS', 500);
export const TOPUP_CUSTOM_MAX_CENTS = intEnv('VOICE_TOPUP_MAX_CENTS', 50000);

/** Currency for every voice charge. */
export const VOICE_CURRENCY = 'aud';

/**
 * Voice minutes **included** with each subscription tier, expressed as an AUD-cent
 * allowance granted into the org's voice wallet at the start of each billing
 * period. Calls draw the balance down (allowance first, then any prepaid top-up);
 * once exhausted, extra use is billed per minute (overage). Env-overridable.
 *
 * Defaults: free has no included voice; starter $20/mo (~20 min); pro $50/mo.
 */
export const TIER_VOICE_ALLOWANCE_CENTS: Record<string, number> = {
    free: intEnv('VOICE_ALLOWANCE_FREE_CENTS', 0),
    starter: intEnv('VOICE_ALLOWANCE_STARTER_CENTS', 2000),
    pro: intEnv('VOICE_ALLOWANCE_PRO_CENTS', 5000),
};

/** Monthly included voice allowance (AUD cents) for a tier; 0 for unknown/free. */
export function monthlyAllowanceCents(tier?: string | null): number {
    const t = tier === 'starter' || tier === 'pro' ? tier : 'free';
    return TIER_VOICE_ALLOWANCE_CENTS[t] ?? 0;
}

/** Current billing-period key, `YYYY-MM` (UTC). The allowance resets per period. */
export function currentBillingPeriod(now: Date = new Date()): string {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Split a call cost into the part covered by the remaining included allowance and
 * the per-minute overage beyond it. Pure — the single source of truth for how
 * allowance vs overage is computed.
 */
export function splitAllowanceOverage(
    costCents: number,
    allowanceRemainingCents: number,
): { fromAllowanceCents: number; overageCents: number } {
    const cost = Math.max(0, Math.round(costCents));
    const remaining = Math.max(0, Math.round(allowanceRemainingCents));
    const fromAllowanceCents = Math.min(cost, remaining);
    return { fromAllowanceCents, overageCents: cost - fromAllowanceCents };
}

/** Minimum balance (AUD cents) required to initiate a call. */
export function minBalanceToCallCents(): number {
    return VOICE_PER_MINUTE_CENTS * VOICE_MIN_CALL_MINUTES;
}

/**
 * Cost (AUD cents) of a connected call of `durationSeconds`. Rounds up to the
 * next whole minute, with a one-minute floor for any answered call so a
 * 5-second pickup still bills a minute.
 */
export function callCostCents(durationSeconds: number): number {
    const secs = Number(durationSeconds);
    if (!Number.isFinite(secs) || secs <= 0) return 0;
    const minutes = Math.max(1, Math.ceil(secs / 60));
    return minutes * VOICE_PER_MINUTE_CENTS;
}

/** True if `amountCents` is a valid custom top-up amount. */
export function isValidTopupAmount(amountCents: number): boolean {
    return (
        Number.isInteger(amountCents) &&
        amountCents >= TOPUP_CUSTOM_MIN_CENTS &&
        amountCents <= TOPUP_CUSTOM_MAX_CENTS
    );
}
