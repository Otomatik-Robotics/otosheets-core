import { and, eq, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { memberships } from '../pg/schema/identity';
import { toRow, fromRow } from '../pg/rows';
import { Membership } from './schema';
import type { IMembershipRepo } from './repo';

export class MembershipPgRepo implements IMembershipRepo {
    constructor(private injected?: PgDb) {}

    private get db(): PgDb {
        return this.injected ?? getPg();
    }

    async getMembership(orgId: string, userId: string): Promise<Membership | null> {
        const rows = await this.db.select().from(memberships)
            .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
            .limit(1);
        return rows[0] ? fromRow<Membership>(rows[0]) : null;
    }

    async listOrgMembers(orgId: string): Promise<Membership[]> {
        const rows = await this.db.select().from(memberships).where(eq(memberships.orgId, orgId));
        return rows.map((r: any) => fromRow<Membership>(r));
    }

    async listUserOrgs(userId: string): Promise<Membership[]> {
        const rows = await this.db.select().from(memberships).where(eq(memberships.userId, userId));
        return rows.map((r: any) => fromRow<Membership>(r));
    }

    async getByInviteToken(token: string): Promise<Membership | null> {
        const rows = await this.db.select().from(memberships)
            .where(eq(memberships.inviteToken, token))
            .limit(1);
        return rows[0] ? fromRow<Membership>(rows[0]) : null;
    }

    async createMembership(orgId: string, userId: string, data: Record<string, any>): Promise<void> {
        const now = new Date();
        await this.db.insert(memberships).values({
            ...toRow(memberships, data, 'membership'),
            orgId,
            userId,
            createdAt: now,
            updatedAt: now,
        } as any);
    }

    async updateMembership(orgId: string, userId: string, updates: Record<string, any>): Promise<void> {
        await this.db.update(memberships)
            .set({ ...toRow(memberships, updates, 'membership'), updatedAt: new Date() } as any)
            .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
    }

    async deleteMembership(orgId: string, userId: string): Promise<void> {
        await this.db.delete(memberships)
            .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
    }

    /** Full-entity mirror upsert — last-writer-wins on updatedAt (§6.1). */
    async upsertMembership(membership: Membership): Promise<void> {
        const row = toRow(memberships, membership as Record<string, any>, 'membership');
        await this.db.insert(memberships)
            .values(row as any)
            .onConflictDoUpdate({
                target: [memberships.orgId, memberships.userId],
                set: row as any,
                setWhere: sql`${memberships.updatedAt} <= excluded.updated_at`,
            });
    }
}
