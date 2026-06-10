import { z } from 'zod';

/**
 * Tracks the sync state of an Otosheets entity to an external accounting ledger
 * (Xero / MYOB). One row per (orgId, entityType, entityId). Stores the external
 * ledger ID so we can decide create-vs-update and stay idempotent — never a copy
 * of the entity's data, only the linking ID + a content hash.
 *
 * PK: orgId
 * SK: `${entityType}#${entityId}`
 */
export const AccountingSyncStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(), // `${entityType}#${entityId}`
    entityType: z.enum(['contact', 'invoice', 'payment', 'expense', 'employee']),
    entityId: z.string(),
    provider: z.enum(['xero', 'myob']),
    externalId: z.string().nullish(), // ledger-side ID (null while PENDING/FAILED before first success)
    externalParentId: z.string().nullish(), // e.g. the invoice's externalId for a payment row
    status: z.enum(['SYNCED', 'PENDING', 'FAILED']),
    contentHash: z.string().nullish(), // hash of the synced payload — unchanged hash ⇒ skip
    lastError: z.string().nullish(),
    lastSyncedAt: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type AccountingSync = z.infer<typeof AccountingSyncStoredSchema>;
export type AccountingSyncEntityType = AccountingSync['entityType'];
export type AccountingSyncStatus = AccountingSync['status'];
