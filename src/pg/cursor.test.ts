import { describe, it, expect } from 'vitest';
import { encodeLekToken, encodeKeysetToken, decodeLek, toKeyset, toLek } from './cursor';

describe('versioned pagination cursors', () => {
    it('v2 keyset round-trips', () => {
        const token = encodeKeysetToken({ createdAt: '2026-07-01T00:00:00.000Z', id: 'inv_123' });
        expect(toKeyset(token, 'invoiceId')).toEqual({ createdAt: '2026-07-01T00:00:00.000Z', id: 'inv_123' });
    });

    it('v1 LEK round-trips and translates to a keyset (sk suffix form)', () => {
        const lek = { orgId: 'org_1', sk: 'user_1#inv_123', createdAt: '2026-07-01T00:00:00.000Z' };
        const token = encodeLekToken(lek);
        expect(decodeLek(token)).toEqual(lek);
        // Postgres repo interpreting a Dynamo token mid-scroll (§6.4)
        expect(toKeyset(token, 'invoiceId')).toEqual({ createdAt: '2026-07-01T00:00:00.000Z', id: 'inv_123' });
    });

    it('v1 LEK with a plain id attribute translates too', () => {
        const token = encodeLekToken({ orgId: 'org_1', invoiceId: 'inv_9', createdAt: '2026-06-01T00:00:00.000Z' });
        expect(toKeyset(token, 'invoiceId')).toEqual({ createdAt: '2026-06-01T00:00:00.000Z', id: 'inv_9' });
    });

    it('legacy bare (unversioned) tokens are treated as v1', () => {
        const bare = Buffer.from(JSON.stringify({ orgId: 'org_1', sk: 'u#inv_7', createdAt: '2026-05-01T00:00:00.000Z' })).toString('base64');
        expect(decodeLek(bare)).toMatchObject({ orgId: 'org_1' });
        expect(toKeyset(bare, 'invoiceId')).toEqual({ createdAt: '2026-05-01T00:00:00.000Z', id: 'inv_7' });
    });

    it('v2 tokens translate back to a Dynamo LEK for rollback (§6.4)', () => {
        const token = encodeKeysetToken({ createdAt: '2026-07-01T00:00:00.000Z', id: 'inv_123' });
        const lek = toLek(token, (c) => ({ orgId: 'org_1', sk: `user_1#${c.id}`, createdAt: c.createdAt }));
        expect(lek).toEqual({ orgId: 'org_1', sk: 'user_1#inv_123', createdAt: '2026-07-01T00:00:00.000Z' });
    });

    it('garbage tokens return null (callers restart from page 1)', () => {
        expect(toKeyset('not-base64-json', 'invoiceId')).toBeNull();
        expect(decodeLek('!!!')).toBeNull();
    });
});
