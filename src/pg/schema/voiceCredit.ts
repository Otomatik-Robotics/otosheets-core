import { pgTable, text, bigint, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { orgs } from './identity';

/**
 * Voice-credit wallet + ledger — docs/POSTGRES_MIGRATION_PLAN.md §4/§6.4.
 * In DynamoDB these share the call-records partition (WALLET# sort keys);
 * here they are dedicated tables. The wallet balance is maintained by atomic
 * increments inside the same transaction that inserts the (deterministic)
 * ledger entry, mirroring the Dynamo transactWrite. entry_id = the Dynamo sk
 * (e.g. WALLET#LEDGER#TOPUP#{sessionId}); keyed with org_id because GRANT#{period}
 * is not globally unique.
 */
export const voiceCreditWallets = pgTable('voice_credit_wallets', {
    orgId: text('org_id').primaryKey().references(() => orgs.orgId, { onDelete: 'cascade' }),
    balanceCents: bigint('balance_cents', { mode: 'number' }).notNull().default(0),
    currency: text('currency'),
    updatedAt: text('updated_at'),
});

export const voiceCreditLedger = pgTable('voice_credit_ledger', {
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),
    entryId: text('entry_id').notNull(),          // = Dynamo sk (WALLET#LEDGER#...)
    type: text('type'),
    amountCents: bigint('amount_cents', { mode: 'number' }),
    callId: text('call_id'),
    stripeSessionId: text('stripe_session_id'),
    period: text('period'),
    description: text('description'),
    createdAt: text('created_at'),
}, (t) => [
    primaryKey({ columns: [t.orgId, t.entryId] }),
    index('voice_credit_ledger_org_created_idx').on(t.orgId, t.createdAt),
]);
