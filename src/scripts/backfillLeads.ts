/**
 * Phase-3 backfill: DynamoDB → Postgres for leads/pipelines/bookings
 * (docs/POSTGRES_MIGRATION_PLAN.md §3/§6.3). `--report` validates offline.
 *
 * Usage:
 *   export AWS_PROFILE=sandbox AWS_REGION=ap-southeast-2
 *   export PIPELINES_TABLE=... LEADS_TABLE=... BOOKINGS_TABLE=... ORGANIZATIONS_TABLE=...
 *   export DATABASE_URL=...   # not needed with --report
 *   node dist/scripts/backfillLeads.js --report
 */
import { ddb } from '../ddbClient';
import { Tables } from '../tables';
import { toRow } from '../pg/rows';
import { dtoToRow, ownerFromSk } from '../pg/billingRows';
import * as pgSchema from '../pg/schema';
import { PipelinePgRepo } from '../pipeline/repo.pg';
import { LeadPgRepo } from '../lead/repo.pg';
import { BookingPgRepo } from '../booking/repo.pg';

interface Counts { scanned: number; ok: number; skipped: { reason: string; key: string }[]; }

async function* scanAll(t: string): AsyncGenerator<Record<string, any>> {
    let k: Record<string, any> | undefined;
    do { const p = await ddb.scan({ TableName: t, ExclusiveStartKey: k }); for (const i of p.Items ?? []) yield i; k = p.LastEvaluatedKey; } while (k);
}
async function run(label: string, table: string, keyOf: (i: any) => string, validate: (i: any) => void, write: (i: any) => Promise<void>, reportOnly: boolean): Promise<Counts> {
    const c: Counts = { scanned: 0, ok: 0, skipped: [] };
    for await (const item of scanAll(table)) { c.scanned++; try { if (reportOnly) validate(item); else await write(item); c.ok++; } catch (e: any) { c.skipped.push({ reason: e?.message ?? String(e), key: keyOf(item) }); } }
    console.log(`[${label}] scanned=${c.scanned} ${reportOnly ? 'validated' : 'wrote'}=${c.ok} skipped=${c.skipped.length}`);
    for (const s of c.skipped) console.warn(`[${label}] SKIPPED ${s.key}: ${s.reason}`);
    return c;
}
function req(i: any, f: string[]): void { const m = f.filter(k => i[k] === undefined || i[k] === null || i[k] === ''); if (m.length) throw new Error(`missing required (NOT NULL) field(s): ${m.join(', ')}`); }

export async function backfillLeads(reportOnly: boolean): Promise<void> {
    const pipelinePg = new PipelinePgRepo(), leadPg = new LeadPgRepo(), bookingPg = new BookingPgRepo();
    const vPipeline = (i: any) => { req(i, ['pipelineId', 'orgId', 'createdBy', 'name']); toRow(pgSchema.pipelines, i, 'pipeline'); };
    const vLead = (i: any) => { req(i, ['leadId', 'orgId', 'createdBy']); const { sk, ...rest } = i; dtoToRow({ ...rest, ownerId: ownerFromSk(i) }, ['quotedAmount'], ['sk']); toRow(pgSchema.leads, { ...rest, ownerId: ownerFromSk(i) }, 'lead'); };
    const vBooking = (i: any) => { req(i, ['bookingId', 'orgId', 'createdBy']); const { sk, dateSk, ...rest } = i; toRow(pgSchema.bookings, { ...rest, ownerId: ownerFromSk(i) }, 'booking'); };

    console.log(`leads backfill (${reportOnly ? 'REPORT-ONLY' : 'WRITE'})`);
    // FK order: pipelines (→orgs) first, then leads (→pipelines), then bookings.
    const results = {
        pipelines: await run('pipelines', Tables.PIPELINES, (i) => i.pipelineId, vPipeline, (i) => pipelinePg.upsertPipeline(i), reportOnly),
        leads: await run('leads', Tables.LEADS, (i) => i.leadId, vLead, (i) => leadPg.upsertLead(i), reportOnly),
        bookings: await run('bookings', Tables.BOOKINGS, (i) => i.bookingId, vBooking, (i) => bookingPg.upsertBooking(i), reportOnly),
    };
    const total = Object.values(results).reduce((n, c) => n + c.skipped.length, 0);
    console.log(`leads backfill complete — total skipped: ${total}`);
    if (total > 0) { console.log('Resolve skips before promotion (§6.3 gate).'); process.exitCode = 2; }
}
if (require.main === module) { backfillLeads(process.argv.includes('--report')).catch((e) => { console.error('leads backfill failed:', e); process.exit(1); }); }
