import { and, gte, inArray, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { merchantCategories, merchantCategoryVotes } from '../pg/schema/merchantCategories';
import { PROMOTION_MIN_ORGS, type MerchantAgreement, type MerchantCategoryHit } from './schema';

/**
 * Postgres-only repo for the shared (cross-tenant) merchant → category cache.
 * Like LedgerMatchPgRepo / ClientOverviewPgRepo there is no Dynamo
 * implementation by design: this is global reference data, read regardless of
 * any cutover flag.
 *
 * Two operations:
 *  - `lookup(keys)` — the read path used before the model batch. Returns ONLY
 *    merchants that cleared the promotion gate (>= PROMOTION_MIN_ORGS distinct
 *    orgs agree on the plurality category), so a lookup hit is a high-confidence
 *    shared prior.
 *  - `recordAgreement(...)` — the write path, called after a CONFIDENT
 *    categorisation (a human-confirmed rule, a user/advisor correction, or a
 *    high-confidence model result). It records the org's vote and recomputes the
 *    derived answer. Fully idempotent under at-least-once replay: the vote is an
 *    upsert keyed on (merchant, category, org) and the promotion gate counts
 *    DISTINCT orgs, so a repeat vote from an org that already voted never moves
 *    the gate. Never call it for shared-cache HITS (that would be circular) or
 *    for generic/empty keys (the caller's denylist filters those first).
 */
export class MerchantCategoryPgRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    /** Batch lookup — promoted answers only, keyed by merchantKey. Generic/empty keys are the caller's job to exclude. */
    async lookup(merchantKeys: string[]): Promise<Map<string, MerchantCategoryHit>> {
        const out = new Map<string, MerchantCategoryHit>();
        const keys = [...new Set(merchantKeys.map((k) => (k ?? '').trim()).filter((k) => k.length > 0))];
        if (keys.length === 0) return out;
        const CHUNK = 500;
        for (let i = 0; i < keys.length; i += CHUNK) {
            const rows = await this.db.select({
                merchantKey: merchantCategories.merchantKey,
                category: merchantCategories.category,
                gstTreatment: merchantCategories.gstTreatment,
                agreeOrgCount: merchantCategories.agreeOrgCount,
            })
                .from(merchantCategories)
                .where(and(
                    inArray(merchantCategories.merchantKey, keys.slice(i, i + CHUNK)),
                    gte(merchantCategories.agreeOrgCount, PROMOTION_MIN_ORGS),
                ));
            for (const r of rows) {
                out.set(r.merchantKey, {
                    merchantKey: r.merchantKey,
                    category: r.category,
                    gstTreatment: r.gstTreatment ?? null,
                    agreeOrgCount: Number(r.agreeOrgCount),
                });
            }
        }
        return out;
    }

    /**
     * Fold one org's confident categorisation into the shared cache and
     * recompute the promoted answer. No-op on a blank key/category/org.
     */
    async recordAgreement(agreement: MerchantAgreement): Promise<void> {
        const merchantKey = (agreement.merchantKey ?? '').trim();
        const category = (agreement.category ?? '').trim();
        const orgId = (agreement.orgId ?? '').trim();
        const gstTreatment = agreement.gstTreatment ?? null;
        if (!merchantKey || !category || !orgId) return;

        // 1) Record this org's vote (distinct-org unit). Idempotent: a replay
        //    from the same org just bumps a soft counter, never a new distinct org.
        await this.db.insert(merchantCategoryVotes)
            .values({ merchantKey, category, orgId, gstTreatment, hits: 1 })
            .onConflictDoUpdate({
                target: [merchantCategoryVotes.merchantKey, merchantCategoryVotes.category, merchantCategoryVotes.orgId],
                set: {
                    hits: sql`${merchantCategoryVotes.hits} + 1`,
                    lastSeenAt: sql`now()`,
                    // Only overwrite the stored treatment when a fresh one is supplied.
                    ...(gstTreatment != null ? { gstTreatment } : {}),
                },
            });

        // 2) Recompute the derived answer from ALL votes for this merchant —
        //    the plurality category across DISTINCT orgs (each vote row is a
        //    distinct org, since org_id is in the PK), with the modal GST
        //    treatment for the winning category. Recomputing from the source of
        //    truth (votes) keeps promotion deterministic and replay-safe.
        const result: any = await this.db.execute(sql`
            SELECT
                category,
                COUNT(*)::int                                       AS org_count,
                SUM(hits)::int                                      AS total_hits,
                MODE() WITHIN GROUP (ORDER BY gst_treatment)        AS gst_treatment
            FROM merchant_category_votes
            WHERE merchant_key = ${merchantKey}
            GROUP BY category
        `);
        const rows: any[] = result.rows ?? result;
        if (rows.length === 0) return;
        // Winner: most distinct orgs, then most total hits, then lexical (fully deterministic).
        const winner = rows
            .map((r) => ({
                category: r.category as string,
                orgCount: Number(r.org_count),
                totalHits: Number(r.total_hits),
                gstTreatment: (r.gst_treatment as string | null) ?? null,
            }))
            .sort((a, b) =>
                b.orgCount - a.orgCount
                || b.totalHits - a.totalHits
                || a.category.localeCompare(b.category))[0];

        // 3) Upsert the promoted answer. Always written (even below the gate) so
        //    the row reflects current evidence; lookups filter on agree_org_count.
        await this.db.insert(merchantCategories)
            .values({
                merchantKey,
                category: winner.category,
                gstTreatment: winner.gstTreatment,
                agreeOrgCount: winner.orgCount,
                totalHits: winner.totalHits,
            })
            .onConflictDoUpdate({
                target: merchantCategories.merchantKey,
                set: {
                    category: winner.category,
                    gstTreatment: winner.gstTreatment,
                    agreeOrgCount: winner.orgCount,
                    totalHits: winner.totalHits,
                    lastSeenAt: sql`now()`,
                    updatedAt: sql`now()`,
                },
            });
    }
}

let singleton: MerchantCategoryPgRepo | null = null;

/** Lazy singleton, mirroring the other pg-only reference/reporting repos. */
export function getMerchantCategoryRepo(): MerchantCategoryPgRepo {
    if (!singleton) singleton = new MerchantCategoryPgRepo();
    return singleton;
}
