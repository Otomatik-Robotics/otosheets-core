import { describe, it, expect, afterEach } from 'vitest';
import { dataBackend, resolveRoute, resetDataBackendCache } from './dataBackend';

afterEach(() => {
    delete process.env.DATA_BACKEND_IDENTITY;
    delete process.env.DATA_BACKEND_BILLING_CORE;
    delete process.env.DATA_BACKEND_SSM_PREFIX;
    resetDataBackendCache();
});

describe('dataBackend', () => {
    it('defaults to dynamo when neither env nor SSM prefix is set (ship-dark safe)', async () => {
        expect(await dataBackend('identity')).toBe('dynamo');
    });

    it('env override wins, including hyphenated domains', async () => {
        process.env.DATA_BACKEND_IDENTITY = 'dual_dynamo';
        process.env.DATA_BACKEND_BILLING_CORE = 'pg';
        expect(await dataBackend('identity')).toBe('dual_dynamo');
        expect(await dataBackend('billing-core')).toBe('pg');
    });

    it('invalid env values are ignored', async () => {
        process.env.DATA_BACKEND_IDENTITY = 'postgres';
        expect(await dataBackend('identity')).toBe('dynamo');
    });
});

describe('resolveRoute — the §6.1 state table', () => {
    it.each([
        ['dynamo',      { primary: 'dynamo', shadow: false }],
        ['dual_dynamo', { primary: 'dynamo', mirror: 'pg', shadow: true }],
        ['dual_pg',     { primary: 'pg', mirror: 'dynamo', shadow: false }],
        ['pg',          { primary: 'pg', shadow: false }],
    ] as const)('%s', async (state, expected) => {
        process.env.DATA_BACKEND_IDENTITY = state;
        expect(await resolveRoute('identity')).toEqual(expected);
    });
});
