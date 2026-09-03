import { describe, it, expect, vi } from 'vitest';
import { DynamoDbAdapter } from './ddbAdapter';

/**
 * Regression for the dual-write mirror outage: a full-entity mirror put that
 * carries a NULL GSI key attribute (inviteToken on an OWNER membership, slug on
 * a fresh user/org, paymentLinkUsageCount on a normal client) was rejected by
 * DynamoDB with "Type mismatch for Index Key ... Actual: NULL" and the error
 * was swallowed by mirrorWrite, leaving the Dynamo mirror empty for every new
 * signup. put() must strip null/undefined top-level attributes so the item is
 * accepted (absent == unset in DynamoDB).
 */
describe('DynamoDbAdapter.put null-stripping', () => {
    function adapterWithSpy() {
        const send = vi.fn().mockResolvedValue({});
        const adapter = new DynamoDbAdapter({ send } as any);
        return { adapter, send };
    }

    it('drops null and undefined top-level attributes (GSI keys) before put', async () => {
        const { adapter, send } = adapterWithSpy();
        await adapter.put('memberships', {
            orgId: 'org_1',
            userId: 'u_1',
            role: 'OWNER',
            inviteToken: null,      // GSI key on InviteTokenIndex — must be absent, not NULL
            invitedBy: undefined,
        });
        const item = send.mock.calls[0][0].input.Item;
        expect(item).toEqual({ orgId: 'org_1', userId: 'u_1', role: 'OWNER' });
        expect('inviteToken' in item).toBe(false);
        expect('invitedBy' in item).toBe(false);
    });

    it('preserves falsy-but-valid values (0, empty string, false)', async () => {
        const { adapter, send } = adapterWithSpy();
        await adapter.put('clients', {
            orgId: 'org_1',
            clientId: 'c_1',
            paymentLinkUsageCount: 0,  // GSI key on UsageCountIndex — 0 is valid, keep it
            note: '',
            archived: false,
        });
        const item = send.mock.calls[0][0].input.Item;
        expect(item.paymentLinkUsageCount).toBe(0);
        expect(item.note).toBe('');
        expect(item.archived).toBe(false);
    });
});
