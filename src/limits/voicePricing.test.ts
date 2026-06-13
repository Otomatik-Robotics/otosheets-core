import { describe, it, expect } from 'vitest';
import {
    callCostCents,
    minBalanceToCallCents,
    isValidTopupAmount,
    VOICE_PER_MINUTE_CENTS,
    VOICE_MIN_CALL_MINUTES,
    TOPUP_CUSTOM_MIN_CENTS,
    TOPUP_CUSTOM_MAX_CENTS,
} from './voicePricing';

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
});
