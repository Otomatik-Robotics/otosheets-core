import { and, eq, sql, desc } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { businessProfiles } from '../pg/schema/businessProfile';
import { toRow, fromRow } from '../pg/rows';
import { BusinessProfile, BusinessProfileCreateRequest } from './schema';

const NUMERIC_KEYS = ['taxRate'];

/**
 * Postgres-only business-profile repo — this table is born in Postgres (no
 * Dynamo counterpart, no data-backend routing). Depends on `dual_pg`.
 */
export class BusinessProfilePgRepo {
    constructor(private injected?: PgDb) {}

    private get db(): PgDb {
        return this.injected ?? getPg();
    }

    /** Create a profile; returns the generated (or supplied) businessProfileId. */
    async create(input: BusinessProfileCreateRequest & { businessProfileId?: string }): Promise<string> {
        const businessProfileId = input.businessProfileId ?? crypto.randomUUID();
        const now = new Date();
        await this.db.insert(businessProfiles)
            .values({
                ...toRow(businessProfiles, { ...input, businessProfileId }, 'businessProfile'),
                createdAt: now,
                updatedAt: now,
            } as any)
            .onConflictDoNothing({ target: businessProfiles.businessProfileId });
        return businessProfileId;
    }

    async getById(businessProfileId: string): Promise<BusinessProfile | null> {
        const rows = await this.db.select().from(businessProfiles)
            .where(eq(businessProfiles.businessProfileId, businessProfileId))
            .limit(1);
        return rows[0] ? fromRow<BusinessProfile>(rows[0], NUMERIC_KEYS) : null;
    }

    /** The org's active profile, resolved by id. */
    async getByOrgAndId(orgId: string, businessProfileId: string): Promise<BusinessProfile | null> {
        const rows = await this.db.select().from(businessProfiles)
            .where(and(
                eq(businessProfiles.businessProfileId, businessProfileId),
                eq(businessProfiles.orgId, orgId),
            ))
            .limit(1);
        return rows[0] ? fromRow<BusinessProfile>(rows[0], NUMERIC_KEYS) : null;
    }

    async listByOrg(orgId: string): Promise<BusinessProfile[]> {
        const rows = await this.db.select().from(businessProfiles)
            .where(eq(businessProfiles.orgId, orgId))
            .orderBy(desc(businessProfiles.createdAt));
        return rows.map((r) => fromRow<BusinessProfile>(r, NUMERIC_KEYS));
    }

    async update(businessProfileId: string, updates: Record<string, any>): Promise<void> {
        await this.db.update(businessProfiles)
            .set({ ...toRow(businessProfiles, updates, 'businessProfile'), updatedAt: new Date() } as any)
            .where(eq(businessProfiles.businessProfileId, businessProfileId));
    }

    /**
     * Hard-delete a profile owned by the org. Callers must ensure it is NOT
     * the org's active profile (the backend guards this) — operational rows
     * attribute to profiles by id, so only unused/orphaned profiles should be
     * deleted. Idempotent: deleting a missing row is a no-op.
     */
    async delete(orgId: string, businessProfileId: string): Promise<void> {
        await this.db.delete(businessProfiles)
            .where(and(
                eq(businessProfiles.businessProfileId, businessProfileId),
                eq(businessProfiles.orgId, orgId),
            ));
    }

    /** Full-entity upsert — last-writer-wins on updatedAt. */
    async upsert(profile: BusinessProfile): Promise<void> {
        const row = toRow(businessProfiles, profile as Record<string, any>, 'businessProfile');
        await this.db.insert(businessProfiles)
            .values(row as any)
            .onConflictDoUpdate({
                target: businessProfiles.businessProfileId,
                set: row as any,
                setWhere: sql`${businessProfiles.updatedAt} <= excluded.updated_at`,
            });
    }
}
