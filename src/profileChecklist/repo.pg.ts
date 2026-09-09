import { and, eq } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { businessProfiles } from '../pg/schema/businessProfile';
import { profileSetupChecklist as items } from '../pg/schema/profileChecklist';
import { ProfileChecklistChange, SETUP_CHECKLIST_ITEMS, type ProfileChecklistItem } from './schema';
export class ProfileChecklistConflict extends Error {}
/** Shared within one profile. Fresh actor membership/role is the authenticated caller's responsibility. */
export class ProfileChecklistPgRepo {
    private readonly scope: Readonly<{orgId: string; businessProfileId: string}>;
    constructor(orgId: string, businessProfileId: string, private readonly injected?: PgDb) {
        if (![orgId,businessProfileId].every(v => typeof v === 'string' && /^[A-Za-z0-9_-]+$/.test(v))) throw new Error('Checklist scope is required');
        this.scope = Object.freeze({orgId,businessProfileId});
    }
    private get db() { return this.injected ?? getPg(); }
    private owned(itemId?: string) { return and(eq(items.orgId,this.scope.orgId), eq(items.businessProfileId,this.scope.businessProfileId), itemId ? eq(items.itemId,itemId) : undefined); }
    private async requireProfile() {
        const [profile] = await this.db.select({id:businessProfiles.businessProfileId}).from(businessProfiles)
            .where(and(eq(businessProfiles.orgId,this.scope.orgId),eq(businessProfiles.businessProfileId,this.scope.businessProfileId))).limit(1);
        if (!profile) throw new Error('Checklist profile is unavailable');
    }
    /** Defaults are a view; reading never seeds ownership or persists anything. */
    async list(): Promise<ProfileChecklistItem[]> {
        await this.requireProfile();
        const rows = await this.db.select().from(items).where(this.owned());
        return SETUP_CHECKLIST_ITEMS.map(item => {
            const row = rows.find(row => row.itemId === item.id);
            return {...item, done:row?.done ?? false, revision:row?.revision ?? 0,
                doneBy:row?.doneBy ?? null, doneAt:row?.doneAt?.toISOString() ?? null,
                updatedBy:row?.updatedBy ?? null, updatedAt:row?.updatedAt?.toISOString() ?? null};
        });
    }
    async set(actorUserId: string, input: ProfileChecklistChange): Promise<void> {
        if (typeof actorUserId !== 'string' || !actorUserId.trim()) throw new Error('Checklist actor is required');
        const change = ProfileChecklistChange.parse(input), now = new Date();
        const values = {done:change.done, revision:change.expectedRevision+1, updatedBy:actorUserId, updatedAt:now,
            doneBy:change.done ? actorUserId : null, doneAt:change.done ? now : null};
        let rows: unknown[];
        if (change.expectedRevision === 0) {
            rows = await this.db.insert(items).values({...this.scope,itemId:change.itemId,...values}).onConflictDoNothing().returning({id:items.itemId});
        } else {
            rows = await this.db.update(items).set(values).where(and(this.owned(change.itemId),eq(items.revision,change.expectedRevision))).returning({id:items.itemId});
        }
        if (!rows.length) throw new ProfileChecklistConflict('Checklist changed; refresh before editing');
    }
}
