import { createHash } from 'crypto';

/**
 * The evidence chain: canonical serialisation, hashing and verification.
 *
 * Deliberately pure and free of the database, because this is the one part of
 * the Documents module that cannot be repaired after the fact. A chain whose
 * bytes were never recorded canonically cannot be re-verified later, so a bug
 * here is not a bug you fix, it is a migration over evidence you no longer have.
 *
 * The inherited implementation this replaces hashed `JSON.stringify(entry)`.
 * That fails for three separate reasons, all of which this file exists to avoid:
 *
 *   1. Key order was object-insertion order, so the same logical entry hashed
 *      differently depending on how it happened to be built.
 *   2. Values were re-encoded on the way back out of the ORM: a timestamp came
 *      back as a Date or an ISO string at a different precision, a numeric came
 *      back as a string, and absent keys reappeared. "Verify chain" could
 *      therefore never pass on a round-tripped row.
 *   3. The previous hash was passed alongside rather than folded in, so a
 *      recomputation had to reproduce the caller's argument order too.
 *
 * Here the previous hash is a field INSIDE the hashed payload, the canonical
 * string is what gets stored, and verification re-hashes that stored string
 * rather than anything reconstructed from columns.
 */

/** A value that may appear in a chain entry. Deliberately narrow. */
export type ChainValue = string | number | boolean | null | ChainValue[] | { [k: string]: ChainValue };

export interface ChainEntryInput {
    envelopeId: string;
    seq: number;
    type: string;
    actorType: 'owner' | 'recipient' | 'system';
    actorId?: string | null;
    actorLabel?: string | null;
    versionId?: string | null;
    recipientId?: string | null;
    detail?: Record<string, ChainValue> | null;
    ip?: string | null;
    userAgent?: string | null;
    /** Server clock, always. Never a timestamp taken from a request body. */
    createdAt: string;
    /** The hash of seq - 1, or null at seq 1. */
    prevHash: string | null;
}

export interface HashedChainEntry {
    canonical: string;
    hash: string;
}

/** Fields that are hashed, in the order they are emitted. Adding one is a chain-format change. */
const HASHED_FIELDS = [
    'envelopeId', 'seq', 'type', 'actorType', 'actorId', 'actorLabel',
    'versionId', 'recipientId', 'detail', 'ip', 'userAgent', 'createdAt', 'prevHash',
] as const;

/**
 * Deterministic JSON. Object keys sorted, no whitespace, and every value type
 * encoded explicitly so nothing depends on the host's default formatting.
 * Throws on anything it cannot encode reproducibly rather than coercing it,
 * because a silent coercion is exactly how a chain stops verifying.
 */
export function canonicalJson(value: ChainValue): string {
    if (value === null) return 'null';

    const t = typeof value;
    if (t === 'string') return JSON.stringify(value);
    if (t === 'boolean') return value ? 'true' : 'false';
    if (t === 'number') {
        if (!Number.isFinite(value as number)) {
            throw new Error('canonicalJson: non-finite number cannot be hashed reproducibly');
        }
        // Integers only inside the chain. A float's shortest round-trip
        // representation is stable in JS but not worth relying on across
        // languages if this is ever verified elsewhere.
        if (!Number.isInteger(value as number)) {
            throw new Error('canonicalJson: use a string for non-integer values');
        }
        return String(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    if (t === 'object') {
        const obj = value as { [k: string]: ChainValue };
        const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
        return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
    }
    throw new Error(`canonicalJson: unsupported value of type ${t}`);
}

/** Normalise an ISO timestamp to UTC with millisecond precision. */
export function canonicalTimestamp(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) throw new Error(`canonicalTimestamp: not a date: ${iso}`);
    return d.toISOString();
}

/**
 * Produce the canonical string and its hash for one entry. The canonical string
 * is what callers must store: verification re-hashes it rather than rebuilding
 * it from columns.
 */
export function hashChainEntry(entry: ChainEntryInput): HashedChainEntry {
    if (!Number.isInteger(entry.seq) || entry.seq < 1) {
        throw new Error('hashChainEntry: seq must be a positive integer');
    }
    if (entry.seq === 1 && entry.prevHash !== null) {
        throw new Error('hashChainEntry: the first entry has no previous hash');
    }
    if (entry.seq > 1 && !entry.prevHash) {
        throw new Error('hashChainEntry: every entry after the first must carry the previous hash');
    }

    const source = entry as unknown as Record<string, unknown>;
    const payload: Record<string, ChainValue> = {};
    for (const field of HASHED_FIELDS) {
        const raw = source[field];
        if (field === 'createdAt') {
            payload[field] = canonicalTimestamp(String(raw));
        } else {
            payload[field] = (raw === undefined ? null : raw) as ChainValue;
        }
    }

    const canonical = canonicalJson(payload);
    return { canonical, hash: createHash('sha256').update(canonical, 'utf8').digest('hex') };
}

export interface StoredChainRow {
    seq: number;
    canonical: string;
    prevHash: string | null;
    hash: string;
}

export type ChainVerdict =
    | { ok: true; length: number }
    | { ok: false; length: number; brokenAtSeq: number; reason: string };

/**
 * Verify a whole chain. Three independent checks, because each catches a
 * different failure: a rewritten entry, a removed one, and a forked one.
 */
export function verifyChain(rows: StoredChainRow[]): ChainVerdict {
    const ordered = [...rows].sort((a, b) => a.seq - b.seq);
    let previous: string | null = null;

    for (let i = 0; i < ordered.length; i++) {
        const row = ordered[i];

        // 1. Contiguity. A gap means an entry was removed, or one was never
        //    written because an append happened outside the transaction.
        if (row.seq !== i + 1) {
            return { ok: false, length: ordered.length, brokenAtSeq: row.seq, reason: `expected seq ${i + 1}, found ${row.seq}` };
        }

        // 2. Integrity. The stored canonical bytes must still hash to the
        //    stored hash, so any edit to the row shows up here.
        const recomputed = createHash('sha256').update(row.canonical, 'utf8').digest('hex');
        if (recomputed !== row.hash) {
            return { ok: false, length: ordered.length, brokenAtSeq: row.seq, reason: 'content does not match its hash' };
        }

        // 3. Linkage. The entry must name its predecessor, and the predecessor
        //    named inside the hashed payload must be the one actually stored.
        if (row.prevHash !== previous) {
            return { ok: false, length: ordered.length, brokenAtSeq: row.seq, reason: 'does not follow the previous entry' };
        }
        let parsed: { prevHash?: string | null };
        try {
            parsed = JSON.parse(row.canonical);
        } catch {
            return { ok: false, length: ordered.length, brokenAtSeq: row.seq, reason: 'canonical form is not readable' };
        }
        const declared = parsed.prevHash ?? null;
        if (declared !== previous) {
            return { ok: false, length: ordered.length, brokenAtSeq: row.seq, reason: 'names a different previous entry than the one stored' };
        }

        previous = row.hash;
    }

    return { ok: true, length: ordered.length };
}
