/**
 * Reverse-delta backfill: Postgres → DynamoDB for the identity domain.
 *
 * This is the rollback path OUT of the `pg` state (plan §6.3 step 7): after
 * Dynamo mirroring stopped, any writes that landed in Postgres exist only
 * there. Before stepping back to `dual_pg`, copy everything Postgres changed
 * since the freeze back into Dynamo. Must exist and be rehearsed BEFORE any
 * domain enters `pg` (§11).
 *
 * Usage:
 *   export AWS_PROFILE=... AWS_REGION=ap-southeast-2
 *   export USERS_TABLE=... ORGANIZATIONS_TABLE=... MEMBERSHIPS_TABLE=... TEAMS_TABLE=...
 *   export DATABASE_URL="postgresql://app_rw:...@.../neondb?sslmode=require"
 *   node dist/scripts/reverseDeltaIdentity.js --since 2026-07-20T00:00:00Z
 *
 * `--since` should be the instant the domain entered `pg` (minus a safety
 * margin). Dynamo writes are full-item puts — idempotent, safe to re-run.
 */
import { gte } from 'drizzle-orm';
import { getPg } from '../pg/client';
import { users, orgs, memberships, teams } from '../pg/schema/identity';
import { fromRow } from '../pg/rows';
import { ddb } from '../ddbClient';
import { UserDynamoRepo } from '../user/repo';
import { OrgDynamoRepo } from '../org/repo';
import { MembershipDynamoRepo } from '../membership/repo';
import { TeamDynamoRepo } from '../team/repo';
import { TeamPgRepo } from '../team/repo.pg';

export async function reverseDeltaIdentity(sinceIso: string): Promise<void> {
    const since = new Date(sinceIso);
    if (Number.isNaN(since.getTime())) throw new Error(`--since is not a valid instant: ${sinceIso}`);
    const db = getPg();
    const userDyn = new UserDynamoRepo(ddb);
    const orgDyn = new OrgDynamoRepo(ddb);
    const membershipDyn = new MembershipDynamoRepo(ddb);
    const teamDyn = new TeamDynamoRepo(ddb);
    const teamPg = new TeamPgRepo();

    console.log(`reverse delta (identity) since ${since.toISOString()}`);

    const changedOrgs = await db.select().from(orgs).where(gte(orgs.updatedAt, since));
    for (const row of changedOrgs as any[]) await orgDyn.upsertOrg(fromRow(row, ['taxRate']));
    console.log(`orgs: ${changedOrgs.length}`);

    const changedUsers = await db.select().from(users).where(gte(users.updatedAt, since));
    for (const row of changedUsers as any[]) await userDyn.upsertUser(fromRow(row));
    console.log(`users: ${changedUsers.length}`);

    const changedMemberships = await db.select().from(memberships).where(gte(memberships.updatedAt, since));
    for (const row of changedMemberships as any[]) await membershipDyn.upsertMembership(fromRow(row));
    console.log(`memberships: ${changedMemberships.length}`);

    // Teams have no updatedAt — copy all (small table), including memberIds.
    const allTeams = await db.select().from(teams);
    for (const row of allTeams as any[]) {
        const team = await teamPg.getTeam(row.orgId, row.teamId);
        if (team) await teamDyn.upsertTeam(team);
    }
    console.log(`teams: ${allTeams.length} (full copy — no updatedAt column)`);

    console.log('reverse delta complete. Deletions since the freeze are NOT replayed — reconcile counts before relying on Dynamo.');
}

if (require.main === module) {
    const idx = process.argv.indexOf('--since');
    const sinceIso = idx >= 0 ? process.argv[idx + 1] : '';
    if (!sinceIso) {
        console.error('Usage: node dist/scripts/reverseDeltaIdentity.js --since <ISO instant>');
        process.exit(1);
    }
    reverseDeltaIdentity(sinceIso).catch((err) => {
        console.error('reverse delta failed:', err);
        process.exit(1);
    });
}
