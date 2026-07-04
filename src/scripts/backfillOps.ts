/**
 * Phase-4 backfill: DynamoDB → Postgres for jobs/time_entries/price_book/
 * receipts/trips (docs/POSTGRES_MIGRATION_PLAN.md §3/§6.3). `--report` validates offline.
 *
 * Usage:
 *   export AWS_PROFILE=sandbox AWS_REGION=ap-southeast-2
 *   export JOBS_TABLE=... TIME_ENTRIES_TABLE=... PRICE_BOOK_TABLE=... RECEIPTS_TABLE=... TRIPS_TABLE=... ORGANIZATIONS_TABLE=...
 *   export DATABASE_URL=...   # not needed with --report
 *   node dist/scripts/backfillOps.js --report
 */
import { ddb } from '../ddbClient';
import { Tables } from '../tables';
import { toRow } from '../pg/rows';
import { dtoToRow, ownerFromSk } from '../pg/billingRows';
import * as pgSchema from '../pg/schema';
import { JobPgRepo } from '../job/repo.pg';
import { TimeEntryPgRepo } from '../timeEntry/repo.pg';
import { PriceBookPgRepo } from '../priceBook/repo.pg';
import { ReceiptPgRepo } from '../receipt/repo.pg';
import { TripPgRepo } from '../trip/repo.pg';

interface C { scanned: number; ok: number; skipped: { reason: string; key: string }[]; }
async function* scan(t: string): AsyncGenerator<Record<string, any>> { let k: any; do { const p = await ddb.scan({ TableName: t, ExclusiveStartKey: k }); for (const i of p.Items ?? []) yield i; k = p.LastEvaluatedKey; } while (k); }
async function run(label: string, table: string, keyOf: (i: any) => string, validate: (i: any) => void, write: (i: any) => Promise<void>, reportOnly: boolean): Promise<C> {
    const c: C = { scanned: 0, ok: 0, skipped: [] };
    for await (const i of scan(table)) { c.scanned++; try { if (reportOnly) validate(i); else await write(i); c.ok++; } catch (e: any) { c.skipped.push({ reason: e?.message ?? String(e), key: keyOf(i) }); } }
    console.log(`[${label}] scanned=${c.scanned} ${reportOnly ? 'validated' : 'wrote'}=${c.ok} skipped=${c.skipped.length}`);
    for (const s of c.skipped) console.warn(`[${label}] SKIPPED ${s.key}: ${s.reason}`);
    return c;
}
function req(i: any, f: string[]): void { const m = f.filter(k => i[k] === undefined || i[k] === null || i[k] === ''); if (m.length) throw new Error(`missing required (NOT NULL): ${m.join(', ')}`); }
// Mirror the repos' STRIP: drop the storage-only sk and any derived *Sk keys.
const skStrip = (i: any) => { const { sk, dateSk, scheduledDateSk, ...rest } = i; return { ...rest, ownerId: ownerFromSk(i) }; };

export async function backfillOps(reportOnly: boolean): Promise<void> {
    const jobPg = new JobPgRepo(), tePg = new TimeEntryPgRepo(), pbPg = new PriceBookPgRepo(), rcPg = new ReceiptPgRepo(), trPg = new TripPgRepo();
    const vJob = (i: any) => { req(i, ['jobId', 'orgId', 'createdBy']); toRow(pgSchema.jobs, skStrip(i), 'job'); };
    const vTe = (i: any) => { req(i, ['timeEntryId', 'orgId', 'createdBy']); toRow(pgSchema.timeEntries, skStrip(i), 'timeEntry'); };
    const vPb = (i: any) => { req(i, ['itemId', 'orgId']); toRow(pgSchema.priceBookItems, i, 'priceBook'); };
    const vRc = (i: any) => { req(i, ['receiptId', 'orgId', 'createdBy']); toRow(pgSchema.receipts, skStrip(i), 'receipt'); };
    const vTr = (i: any) => { req(i, ['tripId', 'orgId', 'createdBy']); toRow(pgSchema.trips, skStrip(i), 'trip'); };

    console.log(`ops backfill (${reportOnly ? 'REPORT-ONLY' : 'WRITE'})`);
    // FK order: jobs (→clients, phase 2 already migrated), then the rest (soft refs).
    const results = {
        jobs: await run('jobs', Tables.JOBS, (i) => i.jobId, vJob, (i) => jobPg.upsertJob(i), reportOnly),
        timeEntries: await run('timeEntries', Tables.TIME_ENTRIES, (i) => i.timeEntryId, vTe, (i) => tePg.upsertTimeEntry(i), reportOnly),
        priceBook: await run('priceBook', Tables.PRICE_BOOK, (i) => i.itemId, vPb, (i) => pbPg.upsertPriceBookItem(i), reportOnly),
        receipts: await run('receipts', Tables.RECEIPTS, (i) => i.receiptId, vRc, (i) => rcPg.upsertReceipt(i), reportOnly),
        trips: await run('trips', Tables.TRIPS, (i) => i.tripId, vTr, (i) => trPg.upsertTrip(i), reportOnly),
    };
    const total = Object.values(results).reduce((n, c) => n + c.skipped.length, 0);
    console.log(`ops backfill complete — total skipped: ${total}`);
    if (total > 0) { console.log('Resolve skips before promotion (§6.3 gate).'); process.exitCode = 2; }
}
if (require.main === module) { backfillOps(process.argv.includes('--report')).catch((e) => { console.error('ops backfill failed:', e); process.exit(1); }); }
