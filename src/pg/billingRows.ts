/**
 * Shared row helpers for the sk/owner_id-carrying phase-3/4 entities (leads,
 * bookings, …). Converts a Dynamo DTO ⇄ pg row: strips the storage-only sk and
 * derived keys, extracts owner_id from the sk prefix, converts ISO-string
 * timestamps to Date, and stringifies numeric columns.
 */
export function ownerFromSk(dto: Record<string, any>): string {
    return typeof dto.sk === 'string' ? dto.sk.split('#')[0] : (dto.createdBy ?? '');
}

const TS_KEYS = new Set(['createdAt', 'updatedAt']);

/** DTO → column row. `strip` are keys handled specially by the caller (sk, derived keys). */
export function dtoToRow(
    dto: Record<string, any>,
    numericKeys: string[],
    strip: string[],
): Record<string, any> {
    const stripSet = new Set(strip);
    const row: Record<string, any> = {};
    for (const [k, v] of Object.entries(dto)) {
        if (stripSet.has(k) || v === undefined) continue;
        if (v === null) row[k] = null;
        else if (TS_KEYS.has(k) && typeof v === 'string') row[k] = new Date(v);
        else if (numericKeys.includes(k) && typeof v === 'number') row[k] = String(v);
        else row[k] = v;
    }
    return row;
}

/** Row → DTO. Drops `pgOnly` columns; converts Dates→ISO and listed numerics→number. */
export function rowToDto<T>(row: Record<string, any>, numericKeys: string[], pgOnly: string[]): T {
    const pgSet = new Set(pgOnly);
    const dto: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) {
        if (pgSet.has(k) || v === null) continue;
        if (v instanceof Date) dto[k] = v.toISOString();
        else if (numericKeys.includes(k) && typeof v === 'string') dto[k] = Number(v);
        else dto[k] = v;
    }
    return dto as T;
}
