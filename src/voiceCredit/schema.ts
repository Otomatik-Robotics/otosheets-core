import { z } from 'zod';

/**
 * Prepaid voice-credit wallet. Org-level (the org is the billable unit), stored
 * in the call-records table under WALLET# sort-key prefixes so it shares the
 * org partition with voice agents (AGENT#) and call records (CALL#).
 *
 *   WALLET#BALANCE                  — the running balance (one per org)
 *   WALLET#LEDGER#TOPUP#{sessionId} — a Stripe top-up (deterministic key = idempotent)
 *   WALLET#LEDGER#CALL#{callId}     — a per-call debit (deterministic key = idempotent)
 *
 * Correctness comes from atomic DynamoDB `ADD` on the balance inside a
 * transaction that also conditionally writes the ledger marker — so a webhook
 * or /outcome retry can never double-apply.
 */

export const WALLET_BALANCE_SK = 'WALLET#BALANCE';
export const WALLET_LEDGER_PREFIX = 'WALLET#LEDGER#';
export const topupLedgerSk = (stripeSessionId: string) => `${WALLET_LEDGER_PREFIX}TOPUP#${stripeSessionId}`;
export const callLedgerSk = (callId: string) => `${WALLET_LEDGER_PREFIX}CALL#${callId}`;

export const VoiceCreditBalanceSchema = z.object({
    orgId: z.string(),
    sk: z.literal(WALLET_BALANCE_SK),
    balanceCents: z.number().default(0),
    currency: z.string().default('aud'),
    updatedAt: z.string(),
});
export type VoiceCreditBalance = z.infer<typeof VoiceCreditBalanceSchema>;

export const VoiceCreditLedgerSchema = z.object({
    orgId: z.string(),
    sk: z.string(), // WALLET#LEDGER#...
    /** topup (+), debit (−, a call charge), refund (+) */
    type: z.enum(['topup', 'debit', 'refund']),
    /** Signed change applied to the balance, AUD cents. */
    amountCents: z.number(),
    callId: z.string().nullish(),
    stripeSessionId: z.string().nullish(),
    description: z.string().nullish(),
    createdAt: z.string(),
});
export type VoiceCreditLedgerEntry = z.infer<typeof VoiceCreditLedgerSchema>;
