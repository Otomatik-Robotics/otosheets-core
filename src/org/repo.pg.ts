import { and, eq, isNull, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { orgs } from '../pg/schema/identity';
import { toRow, fromRow } from '../pg/rows';
import { Organization } from './schema';
import type { IOrgRepo } from './repo';

const NUMERIC_KEYS = ['taxRate'];

export class OrgPgRepo implements IOrgRepo {
    constructor(private injected?: PgDb) {}

    private get db(): PgDb {
        return this.injected ?? getPg();
    }

    async getOrg(orgId: string): Promise<Organization | null> {
        const rows = await this.db.select().from(orgs).where(eq(orgs.orgId, orgId)).limit(1);
        return rows[0] ? fromRow<Organization>(rows[0], NUMERIC_KEYS) : null;
    }

    async getOrgBySlug(slug: string): Promise<Organization | null> {
        const rows = await this.db.select().from(orgs).where(eq(orgs.slug, slug)).limit(1);
        return rows[0] ? fromRow<Organization>(rows[0], NUMERIC_KEYS) : null;
    }

    async createOrg(orgId: string, data: Record<string, any>): Promise<void> {
        const now = new Date();
        await this.db.insert(orgs).values({
            ...toRow(orgs, data, 'org'),
            orgId,
            createdAt: now,
            updatedAt: now,
        } as any);
    }

    async updateOrg(orgId: string, updates: Record<string, any>): Promise<void> {
        await this.db.update(orgs)
            .set({ ...toRow(orgs, updates, 'org'), updatedAt: new Date() } as any)
            .where(eq(orgs.orgId, orgId));
    }

    async setBusinessProfileIdIfUnset(
        orgId: string,
        businessProfileId: string,
    ): Promise<{ won: boolean; businessProfileId: string }> {
        // Single atomic UPDATE ... WHERE business_profile_id IS NULL — only one
        // concurrent caller's row matches, so exactly one wins the claim.
        const updated = await this.db.update(orgs)
            .set({ businessProfileId, updatedAt: new Date() })
            .where(and(eq(orgs.orgId, orgId), isNull(orgs.businessProfileId)))
            .returning({ businessProfileId: orgs.businessProfileId });
        if (updated[0]?.businessProfileId) return { won: true, businessProfileId: updated[0].businessProfileId };
        // Lost (already set) — re-read and defer to the winner's id.
        const rows = await this.db.select({ businessProfileId: orgs.businessProfileId })
            .from(orgs).where(eq(orgs.orgId, orgId)).limit(1);
        return { won: false, businessProfileId: rows[0]?.businessProfileId ?? businessProfileId };
    }

    /** Full-entity mirror upsert — last-writer-wins on updatedAt (§6.1). */
    async upsertOrg(org: Organization): Promise<void> {
        const row = toRow(orgs, org as Record<string, any>, 'org');
        await this.db.insert(orgs)
            .values(row as any)
            .onConflictDoUpdate({
                target: orgs.orgId,
                set: row as any,
                setWhere: sql`${orgs.updatedAt} <= excluded.updated_at`,
            });
    }
}
