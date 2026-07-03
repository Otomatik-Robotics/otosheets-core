import { describe, it, expect, vi, afterEach } from 'vitest';
import { mirrorWrite, shadowRead, normalizeForDiff } from './dualWrite';

afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SHADOW_SAMPLE_IDENTITY;
});

describe('mirrorWrite', () => {
    it('runs the mirror and stays silent on success', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        let ran = false;
        await mirrorWrite({ domain: 'identity', entity: 'user', op: 'createUser', key: { userId: 'u1' } }, async () => {
            ran = true;
        });
        expect(ran).toBe(true);
        expect(spy).not.toHaveBeenCalled();
    });

    it('never throws when the mirror fails — logs the alarmable prefix instead', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(mirrorWrite(
            { domain: 'identity', entity: 'user', op: 'updateUser', key: { userId: 'u1' } },
            async () => { throw new Error('pg exploded'); },
        )).resolves.toBeUndefined();
        expect(spy).toHaveBeenCalledWith('[mirror-write-failure]', expect.stringContaining('pg exploded'));
    });
});

describe('shadowRead', () => {
    const ctx = { domain: 'identity', entity: 'user', op: 'getUser' };

    it('logs a diff when stores disagree (forced 100% sample)', async () => {
        process.env.SHADOW_SAMPLE_IDENTITY = '1';
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await shadowRead(ctx, { name: 'A' }, async () => ({ name: 'B' }), () => 0);
        expect(spy).toHaveBeenCalledWith('[shadow-read-diff]', expect.stringContaining('getUser'));
    });

    it('treats null and undefined as equivalent (Dynamo omits, pg nulls)', async () => {
        process.env.SHADOW_SAMPLE_IDENTITY = '1';
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await shadowRead(ctx, { name: 'A', phone: undefined }, async () => ({ name: 'A', phone: null } as any), () => 0);
        expect(spy).not.toHaveBeenCalled();
    });

    it('skips entirely when the sample misses', async () => {
        process.env.SHADOW_SAMPLE_IDENTITY = '0.1';
        let shadowCalled = false;
        await shadowRead(ctx, { a: 1 }, async () => { shadowCalled = true; return { a: 2 }; }, () => 0.99);
        expect(shadowCalled).toBe(false);
    });

    it('swallows shadow-store errors', async () => {
        process.env.SHADOW_SAMPLE_IDENTITY = '1';
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(shadowRead(ctx, { a: 1 }, async () => { throw new Error('pg down'); }, () => 0)).resolves.toBeUndefined();
        expect(spy).toHaveBeenCalledWith('[shadow-read-error]', expect.stringContaining('pg down'));
    });
});

describe('normalizeForDiff', () => {
    it('sorts keys, drops null/undefined, recurses arrays', () => {
        expect(JSON.stringify(normalizeForDiff({ b: 1, a: null, c: [{ y: undefined, x: 2 }] })))
            .toBe(JSON.stringify({ b: 1, c: [{ x: 2 }] }));
    });
});
