import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
    canonicalJson, canonicalTimestamp, hashChainEntry, verifyChain,
    type ChainEntryInput, type StoredChainRow,
} from './chain';

const base: ChainEntryInput = {
    envelopeId: 'env_1',
    seq: 1,
    type: 'created',
    actorType: 'owner',
    actorId: 'user_1',
    actorLabel: 'Leon',
    versionId: 'ver_1',
    recipientId: null,
    detail: { kind: 'proposal', tier: 0 },
    ip: '203.0.113.44',
    userAgent: 'Chrome',
    createdAt: '2026-09-05T04:05:06.007Z',
    prevHash: null,
};

/** Build a valid chain of n entries, each linked to the last. */
function buildChain(n: number): StoredChainRow[] {
    const rows: StoredChainRow[] = [];
    let prev: string | null = null;
    for (let i = 1; i <= n; i++) {
        const { canonical, hash } = hashChainEntry({ ...base, seq: i, type: `event_${i}`, prevHash: prev });
        rows.push({ seq: i, canonical, prevHash: prev, hash });
        prev = hash;
    }
    return rows;
}

describe('canonicalJson', () => {
    it('is independent of key insertion order', () => {
        const a = canonicalJson({ b: 1, a: 'x', c: null });
        const b = canonicalJson({ c: null, a: 'x', b: 1 });
        expect(a).toBe(b);
        expect(a).toBe('{"a":"x","b":1,"c":null}');
    });

    it('sorts keys at every depth', () => {
        expect(canonicalJson({ z: { b: 1, a: 2 } })).toBe('{"z":{"a":2,"b":1}}');
    });

    it('preserves array order, which is meaningful', () => {
        expect(canonicalJson(['b', 'a'])).toBe('["b","a"]');
    });

    it('drops undefined rather than emitting it', () => {
        expect(canonicalJson({ a: 1, b: undefined as any })).toBe('{"a":1}');
    });

    it('refuses values it cannot encode reproducibly', () => {
        expect(() => canonicalJson(NaN)).toThrow(/non-finite/);
        expect(() => canonicalJson(Infinity)).toThrow(/non-finite/);
        expect(() => canonicalJson(1.5)).toThrow(/non-integer/);
    });
});

describe('canonicalTimestamp', () => {
    it('normalises to UTC with millisecond precision', () => {
        expect(canonicalTimestamp('2026-09-05T14:05:06+10:00')).toBe('2026-09-05T04:05:06.000Z');
        expect(canonicalTimestamp('2026-09-05T04:05:06.007Z')).toBe('2026-09-05T04:05:06.007Z');
    });

    it('rejects a value that is not a date', () => {
        expect(() => canonicalTimestamp('whenever')).toThrow(/not a date/);
    });
});

describe('hashChainEntry', () => {
    it('hashes the canonical string it returns', () => {
        const { canonical, hash } = hashChainEntry(base);
        expect(createHash('sha256').update(canonical, 'utf8').digest('hex')).toBe(hash);
    });

    it('gives the same hash regardless of how the entry was built', () => {
        // The defect this replaces: JSON.stringify over an object graph made the
        // hash depend on insertion order, so the same logical entry hashed twice.
        const reordered: ChainEntryInput = {
            prevHash: null, createdAt: base.createdAt, userAgent: 'Chrome', ip: '203.0.113.44',
            detail: { tier: 0, kind: 'proposal' }, recipientId: null, versionId: 'ver_1',
            actorLabel: 'Leon', actorId: 'user_1', actorType: 'owner', type: 'created',
            seq: 1, envelopeId: 'env_1',
        };
        expect(hashChainEntry(reordered).hash).toBe(hashChainEntry(base).hash);
    });

    it('treats an absent optional field and an explicit null identically', () => {
        const withNull = hashChainEntry({ ...base, actorLabel: null });
        const { actorLabel, ...withoutKey } = base;
        expect(hashChainEntry(withoutKey as ChainEntryInput).hash).toBe(withNull.hash);
    });

    it('normalises the timestamp before hashing, so an equal instant hashes equally', () => {
        const utc = hashChainEntry({ ...base, createdAt: '2026-09-05T04:05:06.000Z' });
        const offset = hashChainEntry({ ...base, createdAt: '2026-09-05T14:05:06+10:00' });
        expect(offset.hash).toBe(utc.hash);
    });

    it('changes the hash when any hashed field changes', () => {
        const original = hashChainEntry(base).hash;
        expect(hashChainEntry({ ...base, type: 'sent' }).hash).not.toBe(original);
        expect(hashChainEntry({ ...base, ip: '198.51.100.1' }).hash).not.toBe(original);
        expect(hashChainEntry({ ...base, detail: { kind: 'proposal', tier: 1 } }).hash).not.toBe(original);
    });

    it('requires the first entry to have no predecessor', () => {
        expect(() => hashChainEntry({ ...base, seq: 1, prevHash: 'abc' })).toThrow(/first entry/);
    });

    it('requires every later entry to name one', () => {
        expect(() => hashChainEntry({ ...base, seq: 2, prevHash: null })).toThrow(/previous hash/);
    });

    it('rejects a seq that is not a positive integer', () => {
        expect(() => hashChainEntry({ ...base, seq: 0 })).toThrow(/positive integer/);
        expect(() => hashChainEntry({ ...base, seq: -1 })).toThrow(/positive integer/);
    });
});

describe('verifyChain', () => {
    it('accepts a well-formed chain', () => {
        expect(verifyChain(buildChain(5))).toEqual({ ok: true, length: 5 });
    });

    it('accepts an empty chain', () => {
        expect(verifyChain([])).toEqual({ ok: true, length: 0 });
    });

    it('does not care what order the rows arrive in', () => {
        const rows = buildChain(4);
        expect(verifyChain([rows[3], rows[0], rows[2], rows[1]])).toEqual({ ok: true, length: 4 });
    });

    it('catches an entry whose content was edited after the fact', () => {
        const rows = buildChain(3);
        rows[1] = { ...rows[1], canonical: rows[1].canonical.replace('event_2', 'event_X') };
        const v = verifyChain(rows);
        expect(v.ok).toBe(false);
        expect(v).toMatchObject({ brokenAtSeq: 2, reason: expect.stringMatching(/does not match its hash/) });
    });

    it('catches a removed entry', () => {
        const rows = buildChain(4);
        const v = verifyChain([rows[0], rows[2], rows[3]]);
        expect(v.ok).toBe(false);
        expect(v).toMatchObject({ brokenAtSeq: 3 });
    });

    it('catches an entry relinked to the wrong predecessor', () => {
        const rows = buildChain(3);
        rows[2] = { ...rows[2], prevHash: rows[0].hash };
        const v = verifyChain(rows);
        expect(v.ok).toBe(false);
        expect(v).toMatchObject({ brokenAtSeq: 3, reason: expect.stringMatching(/does not follow/) });
    });

    it('catches a payload that names a different predecessor than the column', () => {
        // The inherited bug: one write path hard-coded previousHash to 'genesis'
        // whatever its position, so the column and the hashed payload disagreed.
        const rows = buildChain(3);
        const forged = hashChainEntry({ ...base, seq: 3, type: 'event_3', prevHash: 'genesis' });
        rows[2] = { seq: 3, canonical: forged.canonical, prevHash: rows[1].hash, hash: forged.hash };
        const v = verifyChain(rows);
        expect(v.ok).toBe(false);
        expect(v).toMatchObject({ brokenAtSeq: 3, reason: expect.stringMatching(/names a different previous entry/) });
    });

    it('catches an unreadable canonical form', () => {
        const rows = buildChain(2);
        const broken = 'not json';
        rows[1] = { ...rows[1], canonical: broken, hash: createHash('sha256').update(broken, 'utf8').digest('hex') };
        const v = verifyChain(rows);
        expect(v.ok).toBe(false);
        expect(v).toMatchObject({ brokenAtSeq: 2, reason: expect.stringMatching(/not readable/) });
    });
});
