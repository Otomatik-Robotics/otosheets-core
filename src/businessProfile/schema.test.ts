import { describe, it, expect } from 'vitest';
import { BusinessProfileStoredSchema } from './schema';

const base = {
    businessProfileId: 'bp_1', orgId: 'org_1', businessName: 'Co',
    createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z',
};

// The two DTO-level rules 0043 introduces. Backend PUT merges that pass these
// fields through the schema must mirror them (mcc = exactly 4 digits,
// statementDescriptor <= 22 chars per Stripe); pinning them here keeps the
// contract from drifting silently.
describe('BusinessProfileStoredSchema connect fields', () => {
    it('accepts a 4-digit mcc and a descriptor of at most 22 chars', () => {
        const parsed = BusinessProfileStoredSchema.safeParse({
            ...base, mcc: '1711', statementDescriptor: 'A'.repeat(22),
        });
        expect(parsed.success).toBe(true);
    });

    it('rejects a non-4-digit mcc', () => {
        expect(BusinessProfileStoredSchema.safeParse({ ...base, mcc: '171' }).success).toBe(false);
        expect(BusinessProfileStoredSchema.safeParse({ ...base, mcc: '17a1' }).success).toBe(false);
    });

    it('rejects a descriptor longer than 22 chars', () => {
        expect(BusinessProfileStoredSchema.safeParse({
            ...base, statementDescriptor: 'A'.repeat(23),
        }).success).toBe(false);
    });

    it('leaves every connect field optional and nullable', () => {
        const parsed = BusinessProfileStoredSchema.safeParse({
            ...base,
            mcc: null, statementDescriptor: null, connectSensitive: null, connectSensitiveForwardedAt: null,
        });
        expect(parsed.success).toBe(true);
    });
});
