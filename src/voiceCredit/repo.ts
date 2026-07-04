import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import {
    VoiceCreditBalance,
    VoiceCreditLedgerEntry,
    WALLET_BALANCE_SK,
    WALLET_LEDGER_PREFIX,
    topupLedgerSk,
    callLedgerSk,
    grantLedgerSk,
} from './schema';

/**
 * True when a failed transactWrite was cancelled because a ConditionExpression
 * failed — i.e. the ledger marker already existed, so this credit/debit is a
 * duplicate we can safely treat as a no-op (idempotency).
 */
function isDuplicateLedgerWrite(err: any): boolean {
    if (err?.name !== 'TransactionCanceledException') return false;
    const reasons: any[] = err?.CancellationReasons ?? [];
    return reasons.some((r) => r?.Code === 'ConditionalCheckFailed');
}

/** Store-agnostic contract — VoiceCreditDynamoRepo + VoiceCreditPgRepo; VoiceCreditRepo (factory) routes. */
export interface IVoiceCreditRepo {
    getBalance(orgId: string): Promise<number>;
    credit(orgId: string, amountCents: number, meta: { stripeSessionId: string; description?: string }): Promise<number>;
    debit(orgId: string, amountCents: number, meta: { callId: string; description?: string }): Promise<number>;
    grantMonthlyAllowance(orgId: string, period: string, amountCents: number): Promise<number>;
    getPeriodGrant(orgId: string, period: string): Promise<number>;
    listLedger(orgId: string, limit?: number): Promise<VoiceCreditLedgerEntry[]>;
    /** Backfill/mirror: copy a Dynamo WALLET# item (balance or ledger) into the store. */
    upsertWalletItem(item: Record<string, any>): Promise<void>;
}

export class VoiceCreditDynamoRepo implements IVoiceCreditRepo {
    constructor(private ddb: IDdb) {}

    async upsertWalletItem(item: Record<string, any>): Promise<void> {
        await this.ddb.put(Tables.CALL_RECORDS, item);
    }

    /** Current balance in AUD cents (0 if the org has never had credit). */
    async getBalance(orgId: string): Promise<number> {
        const { Item } = await this.ddb.getItem(Tables.CALL_RECORDS, { orgId, sk: WALLET_BALANCE_SK });
        return (Item as VoiceCreditBalance | undefined)?.balanceCents ?? 0;
    }

    /**
     * Add credit from a Stripe top-up. Idempotent on `stripeSessionId`: a webhook
     * replay finds the ledger marker already present and the transaction is a
     * no-op. Returns the (best-effort, strongly-consistent-enough) new balance.
     */
    async credit(
        orgId: string,
        amountCents: number,
        meta: { stripeSessionId: string; description?: string },
    ): Promise<number> {
        const now = new Date().toISOString();
        const sk = topupLedgerSk(meta.stripeSessionId);
        try {
            await this.ddb.transactWrite([
                {
                    Put: {
                        TableName: Tables.CALL_RECORDS,
                        Item: {
                            orgId,
                            sk,
                            type: 'topup',
                            amountCents,
                            stripeSessionId: meta.stripeSessionId,
                            description: meta.description ?? null,
                            createdAt: now,
                        },
                        ConditionExpression: 'attribute_not_exists(sk)',
                    },
                },
                {
                    Update: {
                        TableName: Tables.CALL_RECORDS,
                        Key: { orgId, sk: WALLET_BALANCE_SK },
                        UpdateExpression:
                            'ADD balanceCents :amt SET currency = if_not_exists(currency, :cur), updatedAt = :now',
                        ExpressionAttributeValues: { ':amt': amountCents, ':cur': 'aud', ':now': now },
                    },
                },
            ]);
        } catch (err) {
            if (isDuplicateLedgerWrite(err)) return this.getBalance(orgId);
            throw err;
        }
        return this.getBalance(orgId);
    }

    /**
     * Charge a completed call against the balance. Idempotent on `callId`: an
     * /outcome retry is a no-op. The balance ADD is unconditional (a DynamoDB
     * counter), so a final call may dip slightly negative — the ≥3-minute start
     * gate bounds how far. Returns the new balance.
     */
    async debit(
        orgId: string,
        amountCents: number,
        meta: { callId: string; description?: string },
    ): Promise<number> {
        if (amountCents <= 0) return this.getBalance(orgId);
        const now = new Date().toISOString();
        const sk = callLedgerSk(meta.callId);
        try {
            await this.ddb.transactWrite([
                {
                    Put: {
                        TableName: Tables.CALL_RECORDS,
                        Item: {
                            orgId,
                            sk,
                            type: 'debit',
                            amountCents: -amountCents,
                            callId: meta.callId,
                            description: meta.description ?? null,
                            createdAt: now,
                        },
                        ConditionExpression: 'attribute_not_exists(sk)',
                    },
                },
                {
                    Update: {
                        TableName: Tables.CALL_RECORDS,
                        Key: { orgId, sk: WALLET_BALANCE_SK },
                        UpdateExpression:
                            'ADD balanceCents :neg SET currency = if_not_exists(currency, :cur), updatedAt = :now',
                        ExpressionAttributeValues: { ':neg': -amountCents, ':cur': 'aud', ':now': now },
                    },
                },
            ]);
        } catch (err) {
            if (isDuplicateLedgerWrite(err)) return this.getBalance(orgId);
            throw err;
        }
        return this.getBalance(orgId);
    }

    /**
     * Grant the tier's monthly included voice allowance into the wallet.
     * Idempotent per billing `period` (deterministic GRANT#{period} marker), so
     * calling it repeatedly within a month is a safe no-op — the allowance resets
     * (is re-granted) only when the period key changes. Returns the new balance.
     */
    async grantMonthlyAllowance(
        orgId: string,
        period: string,
        amountCents: number,
    ): Promise<number> {
        if (amountCents <= 0) return this.getBalance(orgId);
        const now = new Date().toISOString();
        const sk = grantLedgerSk(period);
        try {
            await this.ddb.transactWrite([
                {
                    Put: {
                        TableName: Tables.CALL_RECORDS,
                        Item: {
                            orgId,
                            sk,
                            type: 'grant',
                            amountCents,
                            period,
                            description: `Included voice allowance (${period})`,
                            createdAt: now,
                        },
                        ConditionExpression: 'attribute_not_exists(sk)',
                    },
                },
                {
                    Update: {
                        TableName: Tables.CALL_RECORDS,
                        Key: { orgId, sk: WALLET_BALANCE_SK },
                        UpdateExpression:
                            'ADD balanceCents :amt SET currency = if_not_exists(currency, :cur), updatedAt = :now',
                        ExpressionAttributeValues: { ':amt': amountCents, ':cur': 'aud', ':now': now },
                    },
                },
            ]);
        } catch (err) {
            if (isDuplicateLedgerWrite(err)) return this.getBalance(orgId);
            throw err;
        }
        return this.getBalance(orgId);
    }

    /** Allowance granted for `period` (AUD cents), or 0 if not yet granted. */
    async getPeriodGrant(orgId: string, period: string): Promise<number> {
        const { Item } = await this.ddb.getItem(Tables.CALL_RECORDS, { orgId, sk: grantLedgerSk(period) });
        return (Item as { amountCents?: number } | undefined)?.amountCents ?? 0;
    }

    /** Recent ledger entries, newest first (for the credit modal's activity list). */
    async listLedger(orgId: string, limit = 10): Promise<VoiceCreditLedgerEntry[]> {
        const result = await this.ddb.query({
            TableName: Tables.CALL_RECORDS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': WALLET_LEDGER_PREFIX },
            ScanIndexForward: false,
            Limit: limit,
        });
        return (result.Items as VoiceCreditLedgerEntry[]) ?? [];
    }
}
