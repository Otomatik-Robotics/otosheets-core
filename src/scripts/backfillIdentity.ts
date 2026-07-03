/**
 * Phase-1 forward backfill: DynamoDB → Postgres for the identity domain
 * (docs/POSTGRES_MIGRATION_PLAN.md §6.3 step 4).
 *
 * Run AFTER the domain enters `dual_dynamo` (mirror first, then history —
 * the overlap is resolved by the pg repos' LWW upserts, so this script can
 * never clobber a fresher dual-written row). Idempotent; identity tables are
 * small, so each run is a full re-scan (no watermark needed at this size).
 *
 * Usage (from a consumer checkout or the core repo):
 *   export AWS_PROFILE=sandbox AWS_REGION=ap-southeast-2
 *   export USERS_TABLE=... ORGANIZATIONS_TABLE=... MEMBERSHIPS_TABLE=... TEAMS_TABLE=...
 *   export DATABASE_URL="postgresql://app_rw:...@.../neondb?sslmode=require"
 *   node dist/scripts/backfillIdentity.js --report   # validate only, no writes
 *   node dist/scripts/backfillIdentity.js            # backfill
 *
 * Per-row failures (NOT-NULL violations, unique-index collisions, unknown
 * attributes from schema drift) are logged and counted, never fatal — the
 * summary is the §6.3 report that gates promotion.
 */
import { ddb } from '../ddbClient';
import { Tables } from '../tables';
import { toRow } from '../pg/rows';
import * as pgSchema from '../pg/schema';
import { UserPgRepo } from '../user/repo.pg';
import { OrgPgRepo } from '../org/repo.pg';
import { MembershipPgRepo } from '../membership/repo.pg';
import { TeamPgRepo } from '../team/repo.pg';

interface Counts {
    scanned: number;
    upserted: number;
    skipped: { reason: string; key: string }[];
}

async function* scanAll(tableName: string): AsyncGenerator<Record<string, any>> {
    let exclusiveStartKey: Record<string, any> | undefined;
    do {
        const page = await ddb.scan({ TableName: tableName, ExclusiveStartKey: exclusiveStartKey });
        for (const item of page.Items ?? []) yield item;
        exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);
}

async function backfillTable(
    label: string,
    tableName: string,
    keyOf: (item: Record<string, any>) => string,
    upsert: (item: Record<string, any>) => Promise<void>,
    validate: (item: Record<string, any>) => void,
    reportOnly: boolean,
): Promise<Counts> {
    const counts: Counts = { scanned: 0, upserted: 0, skipped: [] };
    for await (const item of scanAll(tableName)) {
        counts.scanned++;
        try {
            // Report mode runs the same DTO→row transform (schema-drift and
            // NOT-NULL checks) without touching Postgres — no DATABASE_URL
            // needed, only Dynamo read access.
            if (reportOnly) validate(item);
            else await upsert(item);
            counts.upserted++;
        } catch (err: any) {
            counts.skipped.push({ reason: err?.message ?? String(err), key: keyOf(item) });
        }
        if (counts.scanned % 500 === 0) console.log(`[${label}] scanned ${counts.scanned}...`);
    }
    console.log(`[${label}] scanned=${counts.scanned} ${reportOnly ? 'validated' : 'upserted'}=${counts.upserted} skipped=${counts.skipped.length}`);
    for (const s of counts.skipped) console.warn(`[${label}] SKIPPED ${s.key}: ${s.reason}`);
    return counts;
}

function requireFields(item: Record<string, any>, fields: string[]): void {
    const missing = fields.filter((f) => item[f] === undefined || item[f] === null || item[f] === '');
    if (missing.length > 0) throw new Error(`missing required (NOT NULL) field(s): ${missing.join(', ')}`);
}

export async function backfillIdentity(reportOnly: boolean): Promise<void> {
    const userPg = new UserPgRepo();
    const orgPg = new OrgPgRepo();
    const membershipPg = new MembershipPgRepo();
    const teamPg = new TeamPgRepo();

    // Offline validators mirroring the pg NOT NULL constraints + strict toRow
    // (unknown-attribute) checks — what WRITE mode would hit, minus the DB.
    const validators = {
        org: (i: Record<string, any>) => { requireFields(i, ['orgId', 'name']); toRow(pgSchema.orgs, i, 'org'); },
        user: (i: Record<string, any>) => { requireFields(i, ['userId', 'email', 'fullName']); toRow(pgSchema.users, i, 'user'); },
        membership: (i: Record<string, any>) => { requireFields(i, ['orgId', 'userId', 'role']); toRow(pgSchema.memberships, i, 'membership'); },
        team: (i: Record<string, any>) => {
            requireFields(i, ['orgId', 'teamId', 'name']);
            const { memberIds, ...rest } = i;
            toRow(pgSchema.teams, rest, 'team');
        },
    };

    console.log(`identity backfill starting (${reportOnly ? 'REPORT-ONLY' : 'WRITE'} mode)`);
    // FK order: orgs and users first, then memberships, then teams.
    const results = {
        orgs: await backfillTable('orgs', Tables.ORGANIZATIONS, (i) => i.orgId, (i) => orgPg.upsertOrg(i as any), validators.org, reportOnly),
        users: await backfillTable('users', Tables.USERS, (i) => i.userId, (i) => userPg.upsertUser(i as any), validators.user, reportOnly),
        memberships: await backfillTable('memberships', Tables.MEMBERSHIPS, (i) => `${i.orgId}/${i.userId}`, (i) => membershipPg.upsertMembership(i as any), validators.membership, reportOnly),
        teams: await backfillTable('teams', Tables.TEAMS, (i) => `${i.orgId}/${i.teamId}`, (i) => teamPg.upsertTeam(i as any), validators.team, reportOnly),
    };

    const totalSkipped = Object.values(results).reduce((n, c) => n + c.skipped.length, 0);
    console.log(`identity backfill complete — total skipped: ${totalSkipped}`);
    if (totalSkipped > 0) {
        console.log('Resolve skips (schema drift / constraint violations) before promotion (§6.3 gate).');
        process.exitCode = 2;
    }
}

if (require.main === module) {
    const reportOnly = process.argv.includes('--report');
    backfillIdentity(reportOnly).catch((err) => {
        console.error('identity backfill failed:', err);
        process.exit(1);
    });
}
