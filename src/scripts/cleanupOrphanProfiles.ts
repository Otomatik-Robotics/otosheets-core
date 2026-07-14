/**
 * One-off cleanup: delete orphaned "empty" business profiles left behind by the
 * pre-fix lazy-seeding race (docs/standards/07-idempotency.md §2). Before the
 * conditional-claim fix in org/repo, concurrent first requests on a fresh org
 * each minted a "New business" profile, so an org could end up with the real
 * profile plus several empty duplicates (dev org org_d161679a-… had three).
 *
 * A profile is a deletion candidate only when ALL of these hold:
 *   1. It is NOT the org's active profile (`orgs.business_profile_id`).
 *   2. It has NO operational rows attributed (nothing references its
 *      `business_profile_id` in any ops/billing/leads/statements/bank table).
 *   3. It is content-empty — no identity/contact/branding/about filled in and
 *      setup never completed — i.e. a seed artifact, not an intentional profile.
 *
 * `--report` (default) lists candidates without deleting. Pass `--delete` to
 * actually remove them.
 *
 * Usage:
 *   export DATABASE_URL=...
 *   node dist/scripts/cleanupOrphanProfiles.js            # report only
 *   node dist/scripts/cleanupOrphanProfiles.js --delete   # perform deletes
 */
import { eq, and, isNotNull } from 'drizzle-orm';
import { getPg } from '../pg/client';
import * as pgSchema from '../pg/schema';
import { businessProfiles } from '../pg/schema/businessProfile';
import { orgs } from '../pg/schema/identity';

/** Any content field being set means the profile is intentional, not a seed artifact. */
const CONTENT_FIELDS = [
    'abn', 'acn', 'legalName', 'tradeName', 'phone', 'businessEmail', 'website',
    'address', 'suburb', 'state', 'postcode', 'bankDetails', 'logoKey', 'brandColor',
    'accentColor', 'template', 'footerText', 'paymentInstructions', 'industry',
    'businessSize', 'operatingHours', 'about', 'serviceAreas', 'targetCustomers',
    'uniqueSellingPoints', 'commonQuestions', 'chatbotTone', 'chatbotInstructions',
    'googleReviewUrl', 'setupCompletedAt',
] as const;

/**
 * Tables that attribute operational rows to a profile via `business_profile_id`,
 * discovered from the schema so new tables are covered automatically. `orgs`
 * (the active pointer) and `business_profiles` itself are excluded.
 */
function usageTables(): { name: string; table: any }[] {
    const out: { name: string; table: any }[] = [];
    for (const [name, table] of Object.entries(pgSchema as Record<string, any>)) {
        if (table === orgs || table === businessProfiles) continue;
        if (table && typeof table === 'object' && (table as any).businessProfileId) {
            out.push({ name, table });
        }
    }
    return out;
}

async function hasOperationalRows(db: any, tables: { name: string; table: any }[], profileId: string): Promise<boolean> {
    for (const { table } of tables) {
        const rows = await db.select({ one: table.businessProfileId })
            .from(table).where(eq(table.businessProfileId, profileId)).limit(1);
        if (rows[0]) return true;
    }
    return false;
}

function isContentEmpty(profile: Record<string, any>): boolean {
    return CONTENT_FIELDS.every((f) => profile[f] === null || profile[f] === undefined);
}

export async function cleanupOrphanProfiles(doDelete: boolean): Promise<void> {
    const db = getPg();
    const tables = usageTables();
    console.log(`orphan-profile cleanup (${doDelete ? 'DELETE' : 'REPORT-ONLY'}) — checking ${tables.length} attribution tables`);

    // Active profile id per org — the one pointer we must never delete.
    const activeRows = await db.select({ orgId: orgs.orgId, active: orgs.businessProfileId })
        .from(orgs).where(isNotNull(orgs.businessProfileId));
    const activeByOrg = new Map<string, string>(activeRows.map((r: any) => [r.orgId, r.active]));

    const all = await db.select().from(businessProfiles);
    let deleted = 0, keptInUse = 0, keptContent = 0, keptActive = 0;

    for (const p of all as any[]) {
        if (activeByOrg.get(p.orgId) === p.businessProfileId) { keptActive++; continue; }
        if (!isContentEmpty(p)) { keptContent++; continue; }
        if (await hasOperationalRows(db, tables, p.businessProfileId)) { keptInUse++; continue; }

        console.log(`  orphan ${p.businessProfileId} (org ${p.orgId}, name=${JSON.stringify(p.businessName)})${doDelete ? ' — deleting' : ''}`);
        if (doDelete) {
            await db.delete(businessProfiles)
                .where(and(eq(businessProfiles.businessProfileId, p.businessProfileId), eq(businessProfiles.orgId, p.orgId)));
            deleted++;
        }
    }

    console.log(
        `done — ${doDelete ? `deleted=${deleted}` : `candidates=${all.length - keptActive - keptContent - keptInUse}`}` +
        ` keptActive=${keptActive} keptContent=${keptContent} keptInUse=${keptInUse}`,
    );
}

if (require.main === module) {
    cleanupOrphanProfiles(process.argv.includes('--delete')).catch((e) => {
        console.error('orphan-profile cleanup failed:', e);
        process.exit(1);
    });
}
