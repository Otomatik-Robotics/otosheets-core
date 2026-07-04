/**
 * Versioned pagination cursors — docs/POSTGRES_MIGRATION_PLAN.md §6.4.
 *
 * The public `nextToken` contract is an opaque Base64 string. Dynamo repos
 * mint `{ v: 1, k: <LastEvaluatedKey> }` (legacy unversioned tokens — a bare
 * Base64 LastEvaluatedKey — are treated as v1). Pg repos mint
 * `{ v: 2, createdAt, id }` keyset cursors.
 *
 * `toKeyset` accepts either version so an infinite-scroll session that
 * started on Dynamo survives a flip to Postgres mid-scroll: the
 * `CreatedAtIndex` LEK carries `createdAt` and the entity id (inside `sk`),
 * which is exactly the keyset. `toLek` covers the rollback direction.
 */

export interface KeysetCursor {
    createdAt: string;
    id: string;
}

function encode(obj: unknown): string {
    return Buffer.from(JSON.stringify(obj)).toString('base64');
}

function decode(token: string): any {
    return JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
}

export function encodeLekToken(lastEvaluatedKey: Record<string, any>): string {
    return encode({ v: 1, k: lastEvaluatedKey });
}

export function encodeKeysetToken(cursor: KeysetCursor): string {
    return encode({ v: 2, ...cursor });
}

/** Extract the raw Dynamo LastEvaluatedKey from a v1 (or legacy bare) token. */
export function decodeLek(token: string): Record<string, any> | null {
    try {
        const parsed = decode(token);
        if (parsed && parsed.v === 1 && parsed.k) return parsed.k;
        if (parsed && parsed.v === undefined && typeof parsed === 'object') return parsed; // legacy bare LEK
        return null;
    } catch {
        return null;
    }
}

/**
 * Interpret any token as a keyset cursor. `idAttribute` names the entity-id
 * attribute in the Dynamo key (e.g. 'invoiceId'); when the id lives in a
 * composite `sk` (`userId#entityId`), it is taken from the SK suffix.
 * Returns null for unparseable tokens (callers restart from page 1).
 */
export function toKeyset(token: string, idAttribute: string): KeysetCursor | null {
    try {
        const parsed = decode(token);
        if (parsed?.v === 2 && parsed.createdAt && parsed.id) {
            return { createdAt: parsed.createdAt, id: parsed.id };
        }
        const lek = parsed?.v === 1 ? parsed.k : parsed?.v === undefined ? parsed : null;
        if (!lek || typeof lek !== 'object') return null;
        const createdAt = lek.createdAt;
        let id: string | undefined = lek[idAttribute];
        if (!id && typeof lek.sk === 'string') id = lek.sk.split('#').pop();
        if (typeof createdAt === 'string' && typeof id === 'string' && id) return { createdAt, id };
        return null;
    } catch {
        return null;
    }
}

/**
 * Interpret a repo's `exclusiveStartKey` (the already-decoded object the
 * handler passes, not a token string) as a keyset cursor. Accepts a pg-minted
 * `{ v:2, createdAt, id }` or a Dynamo LastEvaluatedKey `{ createdAt, <idAttr>|sk }`
 * — so an infinite-scroll session survives a flip mid-scroll (§6.4). Returns
 * null when unusable (caller starts from page 1).
 */
export function keysetFromStartKey(startKey: any, idAttribute: string): KeysetCursor | null {
    if (!startKey || typeof startKey !== 'object') return null;
    if (startKey.v === 2 && startKey.createdAt && startKey.id) {
        return { createdAt: startKey.createdAt, id: startKey.id };
    }
    const createdAt = startKey.createdAt;
    let id: string | undefined = startKey[idAttribute];
    if (!id && typeof startKey.sk === 'string') id = startKey.sk.split('#').pop();
    if (typeof createdAt === 'string' && typeof id === 'string' && id) return { createdAt, id };
    return null;
}

/** The `lastEvaluatedKey` a pg repo returns so the handler's Base64 wrap round-trips. */
export function keysetStartKey(cursor: KeysetCursor): Record<string, any> {
    return { v: 2, createdAt: cursor.createdAt, id: cursor.id };
}

/**
 * Interpret any token as a Dynamo LastEvaluatedKey (rollback direction).
 * `buildLek` reconstructs the store-specific key shape from a keyset cursor.
 */
export function toLek(
    token: string,
    buildLek: (cursor: KeysetCursor) => Record<string, any>,
): Record<string, any> | null {
    const lek = decodeLek(token);
    if (lek) return lek;
    try {
        const parsed = decode(token);
        if (parsed?.v === 2 && parsed.createdAt && parsed.id) {
            return buildLek({ createdAt: parsed.createdAt, id: parsed.id });
        }
        return null;
    } catch {
        return null;
    }
}
