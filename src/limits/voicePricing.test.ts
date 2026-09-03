import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    callCostCents,
    minBalanceToCallCents,
    isValidTopupAmount,
    monthlyAllowanceCents,
    currentBillingPeriod,
    splitAllowanceOverage,
    VOICE_PER_MINUTE_CENTS,
    VOICE_MIN_CALL_MINUTES,
    EXTRA_NUMBER_MONTHLY_CENTS,
    TOPUP_CUSTOM_MIN_CENTS,
    TOPUP_CUSTOM_MAX_CENTS,
} from './voicePricing';

// Option B defaults (PRICING_MODEL.md): PAYG A$1.20/min is the undiscounted rate every
// prepaid package discounts from, and A$9/number sits above Twilio's ~A$4.60 rent.
describe('voicePricing option B defaults', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('defaults to 120 c/min and 900 c/number when no env override is set', () => {
        expect(VOICE_PER_MINUTE_CENTS).toBe(120);
        expect(EXTRA_NUMBER_MONTHLY_CENTS).toBe(900);
    });

    it('env overrides still win, because the constants resolve at module load', async () => {
        vi.stubEnv('VOICE_PER_MINUTE_CENTS', '150');
        vi.stubEnv('VOICE_EXTRA_NUMBER_MONTHLY_CENTS', '1100');
        vi.resetModules();
        const fresh = await import('./voicePricing');
        expect(fresh.VOICE_PER_MINUTE_CENTS).toBe(150);
        expect(fresh.EXTRA_NUMBER_MONTHLY_CENTS).toBe(1100);
    });

    it('a malformed env override falls back to the default rather than zeroing the rate', async () => {
        vi.stubEnv('VOICE_PER_MINUTE_CENTS', 'free');
        vi.resetModules();
        const fresh = await import('./voicePricing');
        expect(fresh.VOICE_PER_MINUTE_CENTS).toBe(120);
    });
});

describe('voicePricing', () => {
    it('minBalanceToCallCents is rate × min-minutes', () => {
        expect(minBalanceToCallCents()).toBe(VOICE_PER_MINUTE_CENTS * VOICE_MIN_CALL_MINUTES);
    });

    it('callCostCents rounds up to the next whole minute', () => {
        expect(callCostCents(61)).toBe(2 * VOICE_PER_MINUTE_CENTS); // 1m1s → 2 min
        expect(callCostCents(60)).toBe(1 * VOICE_PER_MINUTE_CENTS);
        expect(callCostCents(120)).toBe(2 * VOICE_PER_MINUTE_CENTS);
    });

    it('callCostCents bills a one-minute floor for any answered call', () => {
        expect(callCostCents(5)).toBe(VOICE_PER_MINUTE_CENTS);
        expect(callCostCents(1)).toBe(VOICE_PER_MINUTE_CENTS);
    });

    it('callCostCents is zero for a non-connected / zero-duration call', () => {
        expect(callCostCents(0)).toBe(0);
        expect(callCostCents(-3)).toBe(0);
        expect(callCostCents(NaN)).toBe(0);
    });

    it('isValidTopupAmount enforces the custom bounds', () => {
        expect(isValidTopupAmount(TOPUP_CUSTOM_MIN_CENTS)).toBe(true);
        expect(isValidTopupAmount(TOPUP_CUSTOM_MAX_CENTS)).toBe(true);
        expect(isValidTopupAmount(TOPUP_CUSTOM_MIN_CENTS - 1)).toBe(false);
        expect(isValidTopupAmount(TOPUP_CUSTOM_MAX_CENTS + 1)).toBe(false);
        expect(isValidTopupAmount(10.5)).toBe(false);
    });

    it('monthlyAllowanceCents: free has none, paid tiers do; unknown → free', () => {
        expect(monthlyAllowanceCents('free')).toBe(0);
        expect(monthlyAllowanceCents('starter')).toBeGreaterThan(0);
        expect(monthlyAllowanceCents('pro')).toBeGreaterThanOrEqual(monthlyAllowanceCents('starter'));
        expect(monthlyAllowanceCents(null)).toBe(0);
        expect(monthlyAllowanceCents('mystery')).toBe(0);
    });

    it('currentBillingPeriod is a zero-padded YYYY-MM (UTC)', () => {
        expect(currentBillingPeriod(new Date('2026-01-09T00:00:00Z'))).toBe('2026-01');
        expect(currentBillingPeriod(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12');
    });

    it('splitAllowanceOverage covers cost from allowance first, then overage', () => {
        expect(splitAllowanceOverage(100, 1000)).toEqual({ fromAllowanceCents: 100, overageCents: 0 });
        expect(splitAllowanceOverage(1000, 300)).toEqual({ fromAllowanceCents: 300, overageCents: 700 });
        expect(splitAllowanceOverage(500, 0)).toEqual({ fromAllowanceCents: 0, overageCents: 500 });
        expect(splitAllowanceOverage(0, 1000)).toEqual({ fromAllowanceCents: 0, overageCents: 0 });
    });
});
