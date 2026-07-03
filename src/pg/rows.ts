import { getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

/**
 * DTO ⇄ row conversion for pg repos.
 *
 * Drizzle table properties are named identically to the Zod DTO keys, so
 * conversion is only about value types: ISO strings ⇄ Date for timestamp
 * columns, number ⇄ string for NUMERIC columns. Unknown keys throw — the
 * Dynamo impls silently accept ad-hoc attributes, and surfacing that drift
 * loudly during the dual_dynamo soak is exactly the point (§6.3).
 */
export function toRow(table: PgTable, data: Record<string, any>, entity: string): Record<string, any> {
    const columns = getTableColumns(table) as Record<string, any>;
    const out: Record<string, any> = {};
    const unknown: string[] = [];
    for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue; // Dynamo removeUndefinedValues parity
        const col = columns[key];
        if (!col) {
            unknown.push(key);
            continue;
        }
        if (value === null) {
            out[key] = null;
        } else if (col.dataType === 'date' && typeof value === 'string') {
            out[key] = new Date(value);
        } else if (col.columnType === 'PgNumeric' && typeof value === 'number') {
            out[key] = String(value);
        } else {
            out[key] = value;
        }
    }
    if (unknown.length > 0) {
        throw new Error(`[pg:${entity}] unknown attribute(s) not in the Postgres schema: ${unknown.join(', ')}`);
    }
    return out;
}

/** Row → DTO: Dates become ISO strings; listed NUMERIC columns become numbers. */
export function fromRow<T>(row: Record<string, any>, numericKeys: string[] = []): T {
    const out: Record<string, any> = {};
    for (const [key, value] of Object.entries(row)) {
        if (value instanceof Date) {
            out[key] = value.toISOString();
        } else if (typeof value === 'string' && numericKeys.includes(key)) {
            out[key] = Number(value);
        } else {
            out[key] = value;
        }
    }
    return out as T;
}
