/**
 * Voice-credit backfill: DynamoDB (CALL_RECORDS WALLET# items) → Postgres
 * wallet+ledger (docs/POSTGRES_MIGRATION_PLAN.md §4/§6.4). Only WALLET# sort
 * keys are voice-credit; AGENT#/CALL# items in the same partition are skipped.
 * Idempotent. After a WRITE run it verifies, per org, that
 * pg balance == SUM(pg ledger) == Dynamo balance (the §6.4 invariant).
 *
 * Usage:
 *   export AWS_PROFILE=sandbox AWS_REGION=ap-southeast-2
 *   export CALL_RECORDS_TABLE=... DATABASE_URL=...   (DATABASE_URL not needed for --report)
 *   node dist/scripts/backfillVoiceCredit.js [--report]
 */
import { ddb } from '../ddbClient';
import { Tables } from '../tables';
import { getPg } from '../pg/client';
import { voiceCreditWallets, voiceCreditLedger } from '../pg/schema/voiceCredit';
import { WALLET_BALANCE_SK, WALLET_LEDGER_PREFIX } from '../voiceCredit/schema';
import { VoiceCreditPgRepo } from '../voiceCredit/repo.pg';
import { eq, sql } from 'drizzle-orm';

async function* scan(): AsyncGenerator<Record<string, any>> {
    let k: any;
    do { const p = await ddb.scan({ TableName: Tables.CALL_RECORDS, ExclusiveStartKey: k }); for (const i of p.Items ?? []) yield i; k = p.LastEvaluatedKey; } while (k);
}

export async function backfillVoiceCredit(reportOnly: boolean): Promise<void> {
    const pg = new VoiceCreditPgRepo();
    const dynamoBalances = new Map<string, number>();
    let wallets = 0, ledger = 0, skipped = 0;
    console.log(`voice-credit backfill (${reportOnly ? 'REPORT-ONLY' : 'WRITE'})`);
    for await (const item of scan()) {
        const sk: string = item.sk ?? '';
        if (sk === WALLET_BALANCE_SK) {
            dynamoBalances.set(item.orgId, item.balanceCents ?? 0);
            if (!reportOnly) await pg.upsertWalletItem(item);
            wallets++;
        } else if (sk.startsWith(WALLET_LEDGER_PREFIX)) {
            if (!reportOnly) await pg.upsertWalletItem(item);
            ledger++;
        } else { skipped++; } // AGENT# / CALL# — not voice-credit
    }
    console.log(`wallets=${wallets} ledgerEntries=${ledger} (skipped ${skipped} non-wallet items)`);

    if (!reportOnly && dynamoBalances.size > 0) {
        const db = getPg();
        let mismatches = 0;
        for (const [orgId, dynBal] of dynamoBalances) {
            const w = await db.select({ b: voiceCreditWallets.balanceCents }).from(voiceCreditWallets).where(eq(voiceCreditWallets.orgId, orgId));
            const s = await db.select({ s: sql<number>`coalesce(sum(${voiceCreditLedger.amountCents}),0)::bigint` }).from(voiceCreditLedger).where(eq(voiceCreditLedger.orgId, orgId));
            const pgBal = Number(w[0]?.b ?? 0), ledgerSum = Number(s[0]?.s ?? 0);
            const ok = pgBal === dynBal && ledgerSum === dynBal;
            if (!ok) { mismatches++; console.warn(`MISMATCH ${orgId}: dynamo=${dynBal} pgBalance=${pgBal} pgLedgerSum=${ledgerSum}`); }
            else console.log(`  ${orgId}: balance=${pgBal} == ledgerSum == dynamo ✓`);
        }
        console.log(mismatches === 0 ? '✓ voice-credit reconciliation clean (balance == ledger-sum == dynamo)' : `✗ ${mismatches} mismatch(es)`);
        if (mismatches > 0) process.exitCode = 2;
    }
}
if (require.main === module) { backfillVoiceCredit(process.argv.includes('--report')).catch((e) => { console.error('voice-credit backfill failed:', e); process.exit(1); }); }
