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
