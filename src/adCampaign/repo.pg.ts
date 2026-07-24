import { and, eq, desc, lt, or, gte, lte, inArray, sql, isNotNull } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { adCampaigns } from '../pg/schema/adCampaigns';
import { leads } from '../pg/schema/leadsPipelines';
import { analyticsEvents } from '../pg/schema/analytics';
import type {
    AdCampaign, AdCampaignStatus, AdChannel, AdPlatformRef,
    AdCampaignLeadStats, AdCampaignVisitStats, LeadSourceSplitRow,
} from './schema';

/**
 * Every campaign attribute `update` may set. Keyed by DTO name → Drizzle
 * column; anything not listed is ignored, so callers can't write unknown
 * columns (status changes go through `transitionStatus`, never here).
 */
const SETTABLE: Record<string, keyof typeof adCampaigns.$inferInsert> = {
    name: 'name',
    objective: 'objective',
    channels: 'channels',
    destination: 'destination',
    creative: 'creative',
    audience: 'audience',
    budget: 'budget',
    businessProfileId: 'businessProfileId',
    lastInsights: 'lastInsights',
    lastInsightsAt: 'lastInsightsAt',
};

function toDto(row: typeof adCampaigns.$inferSelect): AdCampaign {
    const dto: Record<string, unknown> = {
        campaignId: row.campaignId, orgId: row.orgId, createdBy: row.createdBy,
        name: row.name, objective: row.objective, status: row.status,
        channels: row.channels, destination: row.destination,
        utmCampaign: row.utmCampaign,
        createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
    if (row.businessProfileId != null) dto.businessProfileId = row.businessProfileId;
    if (row.creative != null) dto.creative = row.creative;
    if (row.audience != null) dto.audience = row.audience;
    if (row.budget != null) dto.budget = row.budget;
    if (row.platform != null) dto.platform = row.platform;
    if (row.lastInsights != null) dto.lastInsights = row.lastInsights;
    if (row.lastInsightsAt != null) dto.lastInsightsAt = row.lastInsightsAt;
    return dto as unknown as AdCampaign;
}

function toRow(c: AdCampaign): typeof adCampaigns.$inferInsert {
    return {
        campaignId: c.campaignId, orgId: c.orgId,
        businessProfileId: c.businessProfileId ?? null,
        createdBy: c.createdBy, name: c.name,
        objective: c.objective, status: c.status,
        channels: c.channels, destination: c.destination,
        creative: c.creative ?? null, audience: c.audience ?? null,
        budget: c.budget ?? null, utmCampaign: c.utmCampaign,
        platform: c.platform ?? null,
        lastInsights: c.lastInsights ?? null,
        lastInsightsAt: c.lastInsightsAt ?? null,
        createdAt: c.createdAt, updatedAt: c.updatedAt,
    };
}

/**
 * AdCampaignPgRepo — Postgres-only (no Dynamo mirror; see pg/schema/adCampaigns.ts).
 * Also home to the spend→cash funnel joins over leads + analytics_events, per the
 * reporting-layer convention (accountantReporting precedent: cross-table reads
 * live in one pg repo, not new DynamoDB GSIs).
 */
export class AdCampaignPgRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    /** Conditional create — campaignId is client-minted, so a POST retry is a no-op. */
    async createConditional(campaign: AdCampaign): Promise<boolean> {
        const rows = await this.db.insert(adCampaigns)
            .values(toRow(campaign))
            .onConflictDoNothing({ target: adCampaigns.campaignId })
            .returning({ campaignId: adCampaigns.campaignId });
        return rows.length > 0;
    }

    async get(orgId: string, campaignId: string): Promise<AdCampaign | null> {
        const rows = await this.db.select().from(adCampaigns)
            .where(and(eq(adCampaigns.orgId, orgId), eq(adCampaigns.campaignId, campaignId)))
            .limit(1);
        return rows[0] ? toDto(rows[0]) : null;
    }

    /** Newest-first keyset pagination — same opaque lastEvaluatedKey contract as Dynamo lists. */
    async listByOrg(
        orgId: string,
        opts?: { limit?: number; exclusiveStartKey?: Record<string, any>; status?: AdCampaignStatus },
    ): Promise<{ items: AdCampaign[]; lastEvaluatedKey?: Record<string, any> }> {
        const limit = opts?.limit ?? 20;
        const conds: any[] = [eq(adCampaigns.orgId, orgId)];
        if (opts?.status) conds.push(eq(adCampaigns.status, opts.status));
        const k = opts?.exclusiveStartKey;
        if (k?.createdAt && k?.campaignId) {
            conds.push(or(
                lt(adCampaigns.createdAt, String(k.createdAt)),
                and(eq(adCampaigns.createdAt, String(k.createdAt)), lt(adCampaigns.campaignId, String(k.campaignId))),
            ));
        }
        const rows = await this.db.select().from(adCampaigns).where(and(...conds))
            .orderBy(desc(adCampaigns.createdAt), desc(adCampaigns.campaignId)).limit(limit);
        const last = rows[rows.length - 1];
        return {
            items: rows.map(toDto),
            lastEvaluatedKey: rows.length === limit && last
                ? { orgId, campaignId: last.campaignId, createdAt: last.createdAt }
                : undefined,
        };
    }

    /** All non-ended campaigns' utm slugs — the funnel join key set. */
    async listUtmSlugs(orgId: string): Promise<{ campaignId: string; utmCampaign: string }[]> {
        const rows = await this.db.select({
            campaignId: adCampaigns.campaignId,
            utmCampaign: adCampaigns.utmCampaign,
        }).from(adCampaigns).where(eq(adCampaigns.orgId, orgId));
        return rows;
    }

    /** Patch draft/settings fields through the SETTABLE allowlist. */
    async update(orgId: string, campaignId: string, updates: Record<string, any>): Promise<boolean> {
        const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
        for (const [k, v] of Object.entries(updates)) {
            const col = SETTABLE[k];
            if (col) patch[col] = v;
        }
        const rows = await this.db.update(adCampaigns)
            .set(patch as any)
            .where(and(eq(adCampaigns.orgId, orgId), eq(adCampaigns.campaignId, campaignId)))
            .returning({ campaignId: adCampaigns.campaignId });
        return rows.length > 0;
    }

    /**
     * Single-flight status transition — only the caller that wins the
     * `status IN expectedFrom` condition proceeds (launch double-click /
     * retry safety, same pattern as OrderPgRepo.updateStatus).
     */
    async transitionStatus(
        orgId: string,
        campaignId: string,
        expectedFrom: AdCampaignStatus[],
        to: AdCampaignStatus,
    ): Promise<boolean> {
        const rows = await this.db.update(adCampaigns)
            .set({ status: to, updatedAt: new Date().toISOString() })
            .where(and(
                eq(adCampaigns.orgId, orgId), eq(adCampaigns.campaignId, campaignId),
                inArray(adCampaigns.status, expectedFrom),
            ))
            .returning({ campaignId: adCampaigns.campaignId });
        return rows.length > 0;
    }

    /** Merge one channel's platform refs into the jsonb map (atomic `||`, no read-modify-write). */
    async mergePlatformRef(
        orgId: string,
        campaignId: string,
        channel: AdChannel,
        ref: AdPlatformRef,
    ): Promise<void> {
        const frag = JSON.stringify({ [channel]: ref });
        await this.db.update(adCampaigns)
            .set({
                platform: sql`coalesce(${adCampaigns.platform}, '{}'::jsonb) || ${frag}::jsonb`,
                updatedAt: new Date().toISOString(),
            } as any)
            .where(and(eq(adCampaigns.orgId, orgId), eq(adCampaigns.campaignId, campaignId)));
    }

    /** Cache the latest per-channel insights blob. */
    async setInsights(
        orgId: string,
        campaignId: string,
        insights: Record<string, unknown>,
    ): Promise<void> {
        await this.db.update(adCampaigns)
            .set({ lastInsights: insights, lastInsightsAt: new Date().toISOString() } as any)
            .where(and(eq(adCampaigns.orgId, orgId), eq(adCampaigns.campaignId, campaignId)));
    }

    // ── Funnel joins (reporting layer) ────────────────────────────────────

    /**
     * Per-campaign lead outcomes. `qualified` = progressed beyond NEW;
     * `won` = stage 'won' (case-insensitive) — org stages are free-form, this
     * matches the default pipeline's terminal stage.
     */
    async leadStatsByCampaign(
        orgId: string,
        utmCampaigns: string[],
        fromIso: string,
        toIso: string,
    ): Promise<AdCampaignLeadStats[]> {
        if (utmCampaigns.length === 0) return [];
        const utm = sql<string>`${leads.attribution} ->> 'utmCampaign'`;
        const rows = await this.db.select({
            utmCampaign: utm,
            leads: sql<number>`count(*)`,
            qualified: sql<number>`count(*) filter (where ${leads.stage} is not null and upper(${leads.stage}) <> 'NEW')`,
            won: sql<number>`count(*) filter (where lower(${leads.stage}) = 'won')`,
            wonValue: sql<number>`coalesce(sum(${leads.quotedAmount}) filter (where lower(${leads.stage}) = 'won'), 0)`,
        }).from(leads)
            .where(and(
                eq(leads.orgId, orgId),
                inArray(utm, utmCampaigns),
                gte(leads.createdAt, new Date(fromIso)),
                lte(leads.createdAt, new Date(toIso)),
            ))
            .groupBy(utm);
        return rows.map(r => ({
            utmCampaign: r.utmCampaign,
            leads: Number(r.leads), qualified: Number(r.qualified),
            won: Number(r.won), wonValue: Number(r.wonValue),
        }));
    }

    /** "Where leads come from" — channel split over ALL org leads in the window. */
    async leadSourceSplit(
        orgId: string,
        fromIso: string,
        toIso: string,
    ): Promise<LeadSourceSplitRow[]> {
        const channel = sql<string>`coalesce(${leads.attribution} ->> 'channel', ${leads.attribution} ->> 'utmSource', ${leads.source}, 'direct')`;
        const rows = await this.db.select({
            channel,
            leads: sql<number>`count(*)`,
            won: sql<number>`count(*) filter (where lower(${leads.stage}) = 'won')`,
            wonValue: sql<number>`coalesce(sum(${leads.quotedAmount}) filter (where lower(${leads.stage}) = 'won'), 0)`,
        }).from(leads)
            .where(and(
                eq(leads.orgId, orgId),
                gte(leads.createdAt, new Date(fromIso)),
                lte(leads.createdAt, new Date(toIso)),
            ))
            .groupBy(channel)
            .orderBy(desc(sql`count(*)`));
        return rows.map(r => ({
            channel: r.channel, leads: Number(r.leads),
            won: Number(r.won), wonValue: Number(r.wonValue),
        }));
    }

    /** Campaign-tagged landing traffic from the analytics beacon (pageviews). */
    async visitStatsByCampaign(
        siteIds: string[],
        utmCampaigns: string[],
        fromDay: string,
        toDay: string,
    ): Promise<AdCampaignVisitStats[]> {
        if (siteIds.length === 0 || utmCampaigns.length === 0) return [];
        const rows = await this.db.select({
            utmCampaign: analyticsEvents.utmCampaign,
            visits: sql<number>`count(*)`,
            sessions: sql<number>`count(distinct ${analyticsEvents.sid})`,
        }).from(analyticsEvents)
            .where(and(
                inArray(analyticsEvents.siteId, siteIds),
                eq(analyticsEvents.type, 'pageview'),
                inArray(analyticsEvents.utmCampaign, utmCampaigns),
                isNotNull(analyticsEvents.utmCampaign),
                gte(analyticsEvents.day, fromDay),
                lte(analyticsEvents.day, toDay),
            ))
            .groupBy(analyticsEvents.utmCampaign);
        return rows.map(r => ({
            utmCampaign: r.utmCampaign as string,
            visits: Number(r.visits), sessions: Number(r.sessions),
        }));
    }
}
