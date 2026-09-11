import { sql, type SQL } from 'drizzle-orm';
import type { MatchTargetType } from './schema';

export type MatchingScope = Readonly<{ orgId: string; businessProfileId: string }>;

export function ownedMatchingParent(scope: MatchingScope | undefined, source: 'statement' | 'feed', alias?: string): SQL {
    if (!scope) return sql`true`;
    const child = alias ?? (source === 'statement' ? 'statement_transactions' : 'bank_transactions');
    const table = sql.raw(source === 'statement' ? 'statements' : 'bank_accounts');
    const key = source === 'statement' ? 'statement_id' : 'account_id';
    return sql`EXISTS (SELECT 1 FROM ${table} owned_parent
        WHERE owned_parent.${sql.raw(key)} = ${sql.raw(child + '.' + key)}
          AND owned_parent.user_id = ${sql.raw(child + '.user_id')}
          AND owned_parent.organization_id = ${scope.orgId}
          AND owned_parent.business_profile_id = ${scope.businessProfileId})`;
}

export function ownedMatchingTarget(scope: MatchingScope | undefined, type: MatchTargetType, id: SQL): SQL {
    if (!scope) return sql`true`;
    const table = sql.raw(type === 'INVOICE' ? 'invoices' : 'receipts');
    const key = sql.raw(type === 'INVOICE' ? 'invoice_id' : 'receipt_id');
    return sql`EXISTS (SELECT 1 FROM ${table} owned_target
        WHERE owned_target.${key} = ${id} AND owned_target.org_id = ${scope.orgId}
          AND owned_target.business_profile_id = ${scope.businessProfileId})`;
}

/** Legacy cross-profile links are quarantined rather than returned as foreign IDs. */
export function ownedMatchingRow(scope: MatchingScope | undefined, source: 'statement' | 'feed', alias?: string): SQL {
    if (!scope) return sql`true`;
    const table = alias ?? (source === 'statement' ? 'statement_transactions' : 'bank_transactions');
    const column = (name: string) => sql.raw(table + '.' + name);
    const duplicate = column('duplicate_of_txn_id');
    const duplicateOwned = sql`(EXISTS (SELECT 1 FROM statement_transactions dst WHERE dst.txn_id = ${duplicate}
        AND dst.user_id = ${column('user_id')} AND ${ownedMatchingParent(scope, 'statement', 'dst')})
        OR EXISTS (SELECT 1 FROM bank_transactions dbt WHERE dbt.txn_id = ${duplicate}
        AND dbt.user_id = ${column('user_id')} AND ${ownedMatchingParent(scope, 'feed', 'dbt')}))`;
    const transfer = source === 'statement' ? sql`(${column('transfer_pair_id')} IS NULL OR EXISTS (
        SELECT 1 FROM statement_transactions tst WHERE tst.txn_id = ${column('transfer_pair_id')}
        AND tst.user_id = ${column('user_id')} AND ${ownedMatchingParent(scope, 'statement', 'tst')}))` : sql`true`;
    return sql`${ownedMatchingParent(scope, source, alias)}
        AND (${column('matched_invoice_id')} IS NULL OR ${ownedMatchingTarget(scope, 'INVOICE', column('matched_invoice_id'))})
        AND (${column('matched_receipt_id')} IS NULL OR ${ownedMatchingTarget(scope, 'RECEIPT', column('matched_receipt_id'))})
        AND (${duplicate} IS NULL OR ${duplicateOwned}) AND ${transfer}`;
}

